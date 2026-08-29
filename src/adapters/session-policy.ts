import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnableCard } from "../core/types.js";

/**
 * The Card Session's permissions, per CFA-168: full autonomy inside the worktree,
 * push its own branch, create PRs, comment on its own Card in Linear. The deny list
 * is defense in depth only; the enforced guard is the pre-push hook in `hooksDir`,
 * installed per-worktree, which blocks main/master pushes and remote branch deletion
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

/** Everything that defines what a Card Session may do and how it is started. */
export const cardSessionPolicy = {
  allowedTools: ALLOWED_TOOLS,
  disallowedTools: DISALLOWED_TOOLS,
  /** The pre-push guard, installed per-worktree so it never touches the user's own checkout. */
  hooksDir: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks"),
  prompt: sessionPrompt,
  /** The full claude CLI argument list for one Card Session. */
  cliArgs(runnable: RunnableCard, model: string | null): string[] {
    return [
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
      ...(model ? ["--model", model] : []),
    ];
  },
};
