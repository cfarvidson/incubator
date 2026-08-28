import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeProfile } from "../claude-profile.js";
import { RateLimitError } from "../core/rate-limit.js";
import { formatDuration } from "../core/report.js";
import type { CardExecutorPort, CardSessionResult, RunnableCard } from "../core/types.js";

/**
 * The Card Session's permissions, per CFA-168: full autonomy inside the worktree,
 * push its own branch, create PRs, comment on its own Card in Linear. The deny list
 * is defense in depth only; the enforced guard is the pre-push hook installed
 * per-worktree below, which blocks main/master pushes and remote branch deletion
 * no matter how the command was phrased.
 */
const ALLOWED_TOOLS = [
  "Edit",
  "Write",
  "Read",
  "Glob",
  "Grep",
  "TodoWrite",
  "Bash",
  "mcp__linear-work__save_comment",
];

const DISALLOWED_TOOLS = [
  "Bash(git push origin main:*)",
  "Bash(git push origin master:*)",
  "Bash(git push origin HEAD:*)",
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(git push origin --delete:*)",
  "Bash(git merge:*)",
  "Bash(git branch -D:*)",
  "Bash(git branch -d:*)",
  "Bash(git branch --delete:*)",
  "Bash(git worktree remove:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh api:*)",
];

const HOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks");

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" }).trim();
}

function sessionPrompt(runnable: RunnableCard): string {
  const { card, repo } = runnable;
  return [
    `You are an unattended Card Session executing Linear Card ${card.identifier}: ${card.title}.`,
    `You are in a dedicated git worktree of ${repo} on branch ${card.branchName}, created from the latest default branch.`,
    "",
    "The Brief:",
    "",
    card.brief,
    "",
    "Implement the Brief. Follow the repo's own conventions and run its tests/typechecks where they exist.",
    "Stay inside this worktree; never touch other checkouts of the repo.",
    `When done: commit your work, push the branch (git push -u origin ${card.branchName}),`,
    `and create a pull request with gh pr create, mentioning ${card.identifier} in the PR body.`,
    "Never push to main/master, never merge, never delete branches. Do not change the Card's state in Linear;",
    "you may add a comment to it via the linear-work save_comment tool if something needs explaining.",
  ].join("\n");
}

export interface ExecutorOptions {
  /** The Duration Cap: a stuck session is stopped and its Card Bounced. */
  durationCapMs: number;
  /** Model for Card Sessions; null means the Claude CLI's own default. */
  model: string | null;
  /** The Claude Profile every Card Session of the night runs with. */
  profile: ClaudeProfile;
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

export function makeCardExecutor(options: ExecutorOptions): CardExecutorPort {
  // Worktrees this run created: a rate-limited session may resume in its own
  // worktree, but a leftover from an earlier night stays a hard error.
  const ownWorktrees = new Set<string>();
  return {
    async execute(runnable: RunnableCard): Promise<CardSessionResult> {
      try {
        return await runSession(runnable, options, ownWorktrees);
      } catch (error) {
        if (error instanceof RateLimitError) throw error;
        return { kind: "failure", reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

interface SessionExit {
  timedOut: boolean;
  status: number | null;
  signal: NodeJS.Signals | null;
  /** The tail of the session's combined output, for rate-limit detection. */
  outputTail: string;
}

/** Collapses a tool input to one short line: the command/path if there is one, raw JSON otherwise. */
function summarizeToolInput(input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const summary =
    typeof record.command === "string"
      ? record.command
      : typeof record.file_path === "string"
        ? record.file_path
        : JSON.stringify(record);
  const oneLine = summary.replace(/\s*\n\s*/g, " ");
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

/**
 * Progress lines for one stream-json event, so the terminal shows the session
 * working instead of hours of silence (which reads as a hang and invites the
 * Ctrl+C that orphaned the sessions of 2026-08-27). Returns [] for events not
 * worth a line (tool results and other chatter).
 */
export function renderSessionEvent(event: unknown): string[] {
  if (typeof event !== "object" || event === null) return [];
  const e = event as Record<string, any>;
  if (e.type === "system" && e.subtype === "init") {
    return [`Card Session started (model ${e.model ?? "unknown"})`];
  }
  if (e.type === "assistant") {
    const lines: string[] = [];
    for (const block of e.message?.content ?? []) {
      if (block.type === "text" && block.text.trim() !== "") lines.push(block.text);
      if (block.type === "tool_use") lines.push(`> ${block.name}: ${summarizeToolInput(block.input)}`);
    }
    return lines;
  }
  if (e.type === "result") {
    const outcome = e.is_error ? `failed (${e.subtype})` : "finished";
    const duration = typeof e.duration_ms === "number" ? ` in ${formatDuration(e.duration_ms)}` : "";
    const lines = [`Card Session ${outcome}${duration}`];
    // On success the result text duplicates the already-streamed final assistant message.
    if (e.is_error && typeof e.result === "string" && e.result.trim() !== "") lines.push(e.result);
    return lines;
  }
  return [];
}

function printSessionLine(rawLine: string) {
  if (rawLine.trim() === "") return;
  let lines: string[];
  try {
    lines = renderSessionEvent(JSON.parse(rawLine));
  } catch {
    lines = [rawLine]; // not stream-json (unexpected CLI output): show it untouched
  }
  const stamp = new Date().toLocaleTimeString("sv-SE");
  for (const line of lines) console.log(`[${stamp}] ${line}`);
}

/**
 * Spawns the session detached as its own process group so the duration cap
 * can stop the whole tree (claude plus any builds/tests it spawned), not
 * just the claude process itself. The flip side of detaching is that Ctrl+C
 * no longer reaches the session, so SIGINT is forwarded explicitly: the
 * group is stopped before the Runner exits, instead of leaving an orphan
 * running without a Duration Cap.
 */
export function spawnClaudeSession(
  profile: ClaudeProfile,
  args: string[],
  cwd: string,
  durationCapMs: number,
  onInterrupt: () => void,
): Promise<SessionExit> {
  return new Promise((resolve, reject) => {
    const child = spawn(profile.command, args, {
      cwd,
      env: { ...process.env, ...profile.env },
      stdio: ["inherit", "pipe", "pipe"],
      detached: true,
    });
    let outputTail = "";
    const keepTail = (chunk: Buffer) => {
      outputTail = (outputTail + chunk.toString()).slice(-8192);
    };
    // stdout is stream-json events, rendered one progress line each; stderr passes through raw.
    let lineBuffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      keepTail(chunk);
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;
      for (const line of lines) printSessionLine(line);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      keepTail(chunk);
      process.stderr.write(chunk);
    });
    let timedOut = false;
    let interrupted = false;
    let killTimer: NodeJS.Timeout | undefined;
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal);
      } catch {
        child.kill(signal);
      }
    };
    const stopGroup = () => {
      killGroup("SIGTERM");
      // A session ignoring SIGTERM must not hang the whole Night Run.
      killTimer = setTimeout(() => killGroup("SIGKILL"), 10_000);
    };
    const onSigint = () => {
      interrupted = true;
      console.error("\nCtrl+C: stopping the Card Session, then exiting.");
      onInterrupt();
      stopGroup();
    };
    process.once("SIGINT", onSigint);
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, durationCapMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      reject(error);
    });
    child.once("exit", (status, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener("SIGINT", onSigint);
      if (interrupted) process.exit(130);
      resolve({ timedOut, status, signal, outputTail });
    });
  });
}

async function runSession(
  runnable: RunnableCard,
  options: ExecutorOptions,
  ownWorktrees: Set<string>,
): Promise<CardSessionResult> {
  const { card, clonePath } = runnable;
  const worktreePath = `${clonePath}-${card.identifier.toLowerCase()}`;
  if (existsSync(worktreePath) && !ownWorktrees.has(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}; remove it or finish that run first`);
  }

  if (!ownWorktrees.has(worktreePath)) {
    git(clonePath, ["fetch", "origin"]);
    const base = ["origin/main", "origin/master"].find((ref) => {
      try {
        git(clonePath, ["rev-parse", "--verify", ref]);
        return true;
      } catch {
        return false;
      }
    });
    if (!base) throw new Error(`${clonePath} has neither origin/main nor origin/master`);
    git(clonePath, ["worktree", "add", "-b", card.branchName, worktreePath, base]);

    // The pre-push guard applies only to this worktree, never the user's own checkout.
    git(clonePath, ["config", "extensions.worktreeConfig", "true"]);
    git(worktreePath, ["config", "--worktree", "core.hooksPath", HOOKS_DIR]);
    ownWorktrees.add(worktreePath);
  }

  const session = await spawnClaudeSession(
    options.profile,
    [
      "-p",
      sessionPrompt(runnable),
      // Print mode is silent until the session ends; stream-json (which requires
      // --verbose) surfaces progress so the night is watchable, not hang-like.
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      ALLOWED_TOOLS.join(","),
      "--disallowedTools",
      DISALLOWED_TOOLS.join(","),
      ...(options.model ? ["--model", options.model] : []),
    ],
    worktreePath,
    options.durationCapMs,
    () => options.log(`Interrupted (Ctrl+C); Card Session for ${card.identifier} stopped, Card left In Progress`),
  );
  if (session.timedOut) {
    return {
      kind: "timeout",
      reason: `Card Session for ${card.identifier} hit the ${options.durationCapMs / 3_600_000}h Duration Cap and was stopped`,
    };
  }
  if (session.status !== 0) {
    if (RATE_LIMIT_OUTPUT.test(session.outputTail)) {
      throw new RateLimitError(`Card Session for ${card.identifier} reported rate limiting or exhausted quota`);
    }
    const how = session.status === null ? `was killed by ${session.signal}` : `exited with status ${session.status}`;
    throw new Error(`Card Session for ${card.identifier} ${how}`);
  }

  const prListOutput = execFileSync(
    "gh",
    ["pr", "list", "--head", card.branchName, "--json", "url", "--jq", ".[].url"],
    { cwd: worktreePath, encoding: "utf8" },
  ).trim();
  const prUrls = prListOutput === "" ? [] : prListOutput.split("\n");
  if (prUrls.length === 0) {
    throw new Error(`Card Session for ${card.identifier} finished without creating a PR`);
  }
  return { kind: "success", prUrls };
}
