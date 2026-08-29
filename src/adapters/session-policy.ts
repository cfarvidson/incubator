import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunnableCard } from "../core/types.js";
import type { HarnessKind, HarnessProfile } from "../harness.js";

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

// A Review Session additionally invokes the code-review skill, which spawns its two sub-agents.
const REVIEW_ALLOWED_TOOLS = [...BASE_ALLOWED_TOOLS, "Skill", "Task"];

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

function sessionPrompt(runnable: RunnableCard, hints: TrackerSessionHints, kind: HarnessKind): string {
  const { card, repo } = runnable;
  // Comment hints that need extra tools (Linear's MCP tool) only exist on the claude CLI;
  // any other harness is told to skip commenting instead of improvising with a tool it lacks.
  const commentLine =
    hints.allowedTools.length > 0 && kind !== "claude"
      ? "do not comment on it either (this harness lacks the tracker's comment tool)."
      : `you may add a comment to it ${hints.howToComment(card)} if something needs explaining.`;
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
    commentLine,
  ].join("\n");
}

function reviewPrompt(runnable: RunnableCard, prUrls: string[]): string {
  const { card, repo } = runnable;
  return [
    `You are an unattended Review Session for Card ${card.identifier}: ${card.title}.`,
    `You are in a git worktree of ${repo} on branch ${card.branchName}. A Card Session has just`,
    `opened ${prUrls.length > 1 ? "pull requests" : "a pull request"} from it: ${prUrls.join(" ")}.`,
    "",
    "Invoke your code-review skill on this branch. The fixed point is the",
    "merge-base with the default branch (origin/main or origin/master). The spec is the Card's Brief:",
    "",
    card.brief,
    "",
    "When the review has reported, act on it:",
    "1. Apply the findings that are clear-cut fixes; leave judgement calls you disagree with.",
    `2. Run the repo's tests/typechecks where they exist, then commit and push the fixes to ${card.branchName}.`,
    "3. Post the full review report as a comment on each pull request with gh pr comment <url> --body-file <file>,",
    "   noting which findings you applied and which you left (and why).",
    "Never push to main/master, never merge, never delete branches. Do not change the Card's state in its tracker.",
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
    return harnessArgs(sessionPrompt(runnable, hints, harness.kind), harness, this.allowedTools(hints));
  },
  reviewPrompt,
  /**
   * The argument list for a Review Session: the kind's usual shape, plus (on claude)
   * the tools the code-review skill needs to spawn its sub-agents.
   */
  reviewArgs(runnable: RunnableCard, harness: HarnessProfile, prUrls: string[]): string[] {
    return harnessArgs(reviewPrompt(runnable, prUrls), harness, REVIEW_ALLOWED_TOOLS);
  },
};

/** One prompt, shaped by the Harness Profile's kind; shared by Card and Review Sessions. */
function harnessArgs(prompt: string, harness: HarnessProfile, allowedTools: string[]): string[] {
  // A configured args template outranks the kind's built-in shape; the resolver has already
  // checked that a set model and a "{model}" slot come together, so nothing is dropped here.
  if (harness.args) {
    return harness.args.map((arg) => (arg === "{prompt}" ? prompt : arg === "{model}" ? (harness.model ?? "") : arg));
  }
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
    allowedTools.join(","),
    "--disallowedTools",
    DISALLOWED_TOOLS.join(","),
    ...(harness.model ? ["--model", harness.model] : []),
  ];
}
