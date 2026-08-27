import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RateLimitError } from "../core/rate-limit.js";
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
  maxCardDurationMs: number;
  /** Model for Card Sessions; null means the Claude CLI's own default. */
  model: string | null;
}

/**
 * When the CLI reports rate limiting or exhausted quota, the whole session is
 * retried after the core's backoff; only phrases the CLI itself emits are
 * matched, on a failed exit, to avoid mistaking session chatter for a limit.
 */
const RATE_LIMIT_OUTPUT = /usage limit reached|rate limit/i;

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

/**
 * Spawns the session detached as its own process group so the duration cap
 * can stop the whole tree (claude plus any builds/tests it spawned), not
 * just the claude process itself.
 */
function spawnClaudeSession(args: string[], cwd: string, maxCardDurationMs: number): Promise<SessionExit> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["inherit", "pipe", "pipe"], detached: true });
    let outputTail = "";
    const passThrough = (from: NodeJS.ReadableStream, to: NodeJS.WritableStream) => {
      from.on("data", (chunk: Buffer) => {
        to.write(chunk);
        outputTail = (outputTail + chunk.toString()).slice(-8192);
      });
    };
    passThrough(child.stdout!, process.stdout);
    passThrough(child.stderr!, process.stderr);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, maxCardDurationMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (status, signal) => {
      clearTimeout(timer);
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
    [
      "-p",
      sessionPrompt(runnable),
      "--allowedTools",
      ALLOWED_TOOLS.join(","),
      "--disallowedTools",
      DISALLOWED_TOOLS.join(","),
      ...(options.model ? ["--model", options.model] : []),
    ],
    worktreePath,
    options.maxCardDurationMs,
  );
  if (session.timedOut) {
    return {
      kind: "timeout",
      reason: `Card Session for ${card.identifier} hit the ${options.maxCardDurationMs / 3_600_000}h duration cap and was stopped`,
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
