import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardExecutorPort, CardOutcome, RunnableCard } from "../core/types.js";

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

export function makeCardExecutor(): CardExecutorPort {
  return {
    async execute(runnable: RunnableCard): Promise<CardOutcome> {
      const { card, clonePath } = runnable;
      const worktreePath = `${clonePath}-${card.identifier.toLowerCase()}`;
      if (existsSync(worktreePath)) {
        throw new Error(`Worktree already exists at ${worktreePath}; remove it or finish that run first`);
      }

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

      const session = spawnSync(
        "claude",
        [
          "-p",
          sessionPrompt(runnable),
          "--allowedTools",
          ALLOWED_TOOLS.join(","),
          "--disallowedTools",
          DISALLOWED_TOOLS.join(","),
        ],
        { cwd: worktreePath, stdio: "inherit" },
      );
      if (session.status !== 0) {
        throw new Error(`Card Session for ${card.identifier} exited with status ${session.status}`);
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
      return { prUrls };
    },
  };
}
