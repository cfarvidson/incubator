import { execFileSync } from "node:child_process";
import type { HarnessProfile } from "../harness.js";
import type { DurationCap } from "../core/duration-cap.js";
import type { CardExecutorPort, CardSessionResult, RunnableCard } from "../core/types.js";
import { cardSessionPolicy, type TrackerSessionHints } from "./session-policy.js";
import { makeSessionRenderer } from "./session-renderer.js";
import { makeProcessSupervisor, type ProcessEnd } from "./supervised-process.js";
import { makeWorktrees } from "./worktree.js";

export interface ExecutorOptions {
  /** The Duration Cap: a stuck session is stopped and its Card Bounced. */
  durationCap: DurationCap;
  /** The Harness Profile every Card Session of the night runs with (agent CLI, model, credentials). */
  harness: HarnessProfile;
  /** How a Card Session may comment on its Card; supplied by the active tracker. */
  sessionHints: TrackerSessionHints;
  /** Run a Review Session (/code-review) on each PR a Card Session opens; the Tracker Profile's autoCodeReview. */
  autoCodeReview: boolean;
  /** Run Log line, so an interrupted night is reconstructable in the morning. */
  log: (message: string) => void;
}

/**
 * Heuristic rate-limit detection: matched against the tail of a *failed*
 * session's output, which includes session chatter, so only phrasings the
 * CLI/API emit for limits are listed - never a bare "rate limit", which a
 * session working on rate-limiting code would print. A false positive cannot
 * wedge the night: the core stops retrying at the Stop Time and Bounces.
 */
const RATE_LIMIT_OUTPUT = /usage limit reached|rate[ _-]?limit(ed|_error)|too many requests|quota exceeded/i;

/** Composes worktree, policy, supervised process, and renderer into the Card Executor. */
export function makeCardExecutor(options: ExecutorOptions): CardExecutorPort {
  const worktrees = makeWorktrees(cardSessionPolicy.hooksDir);
  const supervisor = makeProcessSupervisor();

  return {
    async execute(runnable: RunnableCard): Promise<CardSessionResult> {
      const { card } = runnable;
      const worktreePath = worktrees.ensure(runnable);

      const renderer = makeSessionRenderer();
      const session = await supervisor.run(
        options.harness.command,
        cardSessionPolicy.cliArgs(runnable, options.harness, options.sessionHints),
        {
        cwd: worktreePath,
        env: { ...process.env, ...options.harness.env },
        capMs: options.durationCap.ms,
        onStdout: (chunk) => renderer.feed(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
        // cli.ts already tells the user Ctrl+C is winding the night down; this records it for the morning.
        onInterrupt: () => options.log(`Interrupted (Ctrl+C); Card Session for ${card.identifier} stopped`),
      });
      renderer.end();

      const failed = interpretFailure(session, runnable, options.durationCap);
      if (failed) return failed;

      const prListOutput = execFileSync(
        "gh",
        ["pr", "list", "--head", card.branchName, "--json", "url", "--jq", ".[].url"],
        { cwd: worktreePath, encoding: "utf8" },
      ).trim();
      const prUrls = prListOutput === "" ? [] : prListOutput.split("\n");
      if (prUrls.length === 0) {
        return { kind: "failure", reason: `Card Session for ${card.identifier} finished without creating a PR` };
      }
      if (options.autoCodeReview) await reviewPullRequests(runnable, prUrls, worktreePath);
      return { kind: "success", prUrls };
    },
  };

  /**
   * The PR already exists, so a Review Session that fails, times out, or is
   * interrupted never fails the Card; instead the Runner posts a comment on the
   * PR saying the review was aborted and why, so an unreviewed PR is visible
   * where it will be read, not only in the Run Log.
   */
  async function reviewPullRequests(runnable: RunnableCard, prUrls: string[], worktreePath: string): Promise<void> {
    const { card } = runnable;
    options.log(`Auto code review for ${card.identifier}: ${prUrls.join(" ")}`);
    const renderer = makeSessionRenderer();
    const review = await supervisor.run(
      options.harness.command,
      cardSessionPolicy.reviewArgs(runnable, options.harness, prUrls),
      {
        cwd: worktreePath,
        env: { ...process.env, ...options.harness.env },
        capMs: options.durationCap.ms,
        onStdout: (chunk) => renderer.feed(chunk),
        onStderr: (chunk) => process.stderr.write(chunk),
        onInterrupt: () => options.log(`Interrupted (Ctrl+C); Review Session for ${card.identifier} stopped`),
      },
    );
    renderer.end();
    const aborted = reviewAborted(review, options.durationCap);
    if (!aborted) return;
    options.log(`Review Session for ${card.identifier} ${aborted}; the PR stands as created`);
    const body = `Auto code review was aborted: the Review Session ${aborted}. This PR may be partially or not at all reviewed; review it manually.`;
    for (const url of prUrls) {
      try {
        execFileSync("gh", ["pr", "comment", url, "--body", body], { cwd: worktreePath, stdio: "ignore" });
      } catch {
        options.log(`Could not post the aborted-review comment on ${url}`);
      }
    }
  }
}

/** Why a Review Session did not finish, as a sentence fragment; null means it exited cleanly. */
function reviewAborted(review: ProcessEnd, cap: DurationCap): string | null {
  if (review.interrupted) return "was interrupted (Ctrl+C wound the night down)";
  if (review.timedOut) return `hit the ${cap.prose} Duration Cap and was stopped`;
  if (review.status !== 0) {
    return review.status === null ? `was killed by ${review.signal}` : `exited with status ${review.status}`;
  }
  return null;
}

/** The non-success outcomes of a session, in precedence order; null means it exited cleanly. */
function interpretFailure(session: ProcessEnd, runnable: RunnableCard, cap: DurationCap): CardSessionResult | null {
  const { card } = runnable;
  if (session.interrupted) return { kind: "interrupted" };
  if (session.timedOut) {
    return {
      kind: "timeout",
      reason: `Card Session for ${card.identifier} hit the ${cap.prose} Duration Cap and was stopped`,
    };
  }
  if (session.status !== 0) {
    if (RATE_LIMIT_OUTPUT.test(session.outputTail)) return { kind: "rate-limited" };
    const how = session.status === null ? `was killed by ${session.signal}` : `exited with status ${session.status}`;
    return { kind: "failure", reason: `Card Session for ${card.identifier} ${how}` };
  }
  return null;
}
