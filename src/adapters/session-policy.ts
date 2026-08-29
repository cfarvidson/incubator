import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnableCard } from "../core/types.js";
import type { HarnessProfile } from "../harness.js";

/**
 * The Card Session's permissions, per CFA-168: full autonomy inside the worktree,
 * push its own branch, create PRs, comment on its own Card in its tracker. The deny list
 * is defense in depth only; the enforced guard is the pre-push hook in `hooksDir`,
 * installed per-worktree, which blocks main/master pushes and remote branch deletion
 * no matter how the command was phrased.
 */
/** What the active tracker contributes to a Card Session: how it may comment on its own Card. */
export interface TrackerSessionHints {
  /** Tools beyond the base list the session needs to comment on its Card (may be empty). */
  allowedTools: string[];
  /** Completes "you may add a comment to it ..." in the session prompt. */
  howToComment(card: { url: string }): string;
}

const BASE_ALLOWED_TOOLS = ["Edit", "Write", "Read", "Glob", "Grep", "TodoWrite", "Bash"];

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

function sessionPrompt(runnable: RunnableCard, hints: TrackerSessionHints): string {
  const { card, repo } = runnable;
  return [
    `You are an unattended Card Session executing Card ${card.identifier}: ${card.title}.`,
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
    "Never push to main/master, never merge, never delete branches. Do not change the Card's state in its tracker;",
    `you may add a comment to it ${hints.howToComment(card)} if something needs explaining.`,
  ].join("\n");
}

/** Everything that defines what a Card Session may do and how it is started. */
export const cardSessionPolicy = {
  allowedTools(hints: TrackerSessionHints): string[] {
    return [...BASE_ALLOWED_TOOLS, ...hints.allowedTools];
  },
  disallowedTools: DISALLOWED_TOOLS,
  /** The pre-push guard, installed per-worktree so it never touches the user's own checkout. */
  hooksDir: join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hooks"),
  prompt: sessionPrompt,
  /**
   * The full argument list for one Card Session, shaped by the Harness Profile's
   * kind. The claude tool policy has no equivalent elsewhere: for other kinds the
   * per-worktree pre-push hook is the guard, as it already is in depth for claude.
   */
  cliArgs(runnable: RunnableCard, harness: HarnessProfile, hints: TrackerSessionHints): string[] {
    const prompt = sessionPrompt(runnable, hints);
    // A configured args template outranks the kind's built-in shape.
    if (harness.args) return harness.args.map((arg) => (arg === "{prompt}" ? prompt : arg));
    if (harness.kind === "codex") {
      return [
        "exec",
        // Sandboxed to the worktree, but with network: the session must git push and gh pr create.
        "--sandbox",
        "workspace-write",
        "-c",
        "sandbox_workspace_write.network_access=true",
        ...(harness.model ? ["--model", harness.model] : []),
        prompt,
      ];
    }
    return [
      "-p",
      prompt,
      // Print mode is silent until the session ends; stream-json (which requires
      // --verbose) surfaces progress so the night is watchable, not hang-like.
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      this.allowedTools(hints).join(","),
      "--disallowedTools",
      DISALLOWED_TOOLS.join(","),
      ...(harness.model ? ["--model", harness.model] : []),
    ];
  },
};
