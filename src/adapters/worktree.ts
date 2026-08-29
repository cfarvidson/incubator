import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { RunnableCard } from "../core/types.js";

/** Runs one git command in a repo and returns its trimmed stdout; throws on non-zero exit. */
export type RunGit = (repoPath: string, args: string[]) => string;

export interface WorktreeDeps {
  git?: RunGit;
  exists?: (path: string) => boolean;
}

function realGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" }).trim();
}

export interface Worktrees {
  /** A fresh worktree for this Card, or fail; returns its path. */
  ensure(runnable: RunnableCard): string;
}

/**
 * Gives every Card Session a fresh worktree off the latest default branch,
 * with the pre-push guard installed. Worktrees this run created are remembered:
 * a rate-limited session may resume in its own worktree, but a leftover from an
 * earlier night stays a hard error.
 */
export function makeWorktrees(hooksDir: string, deps: WorktreeDeps = {}): Worktrees {
  const git = deps.git ?? realGit;
  const exists = deps.exists ?? existsSync;
  const ownWorktrees = new Set<string>();
  return {
    ensure(runnable: RunnableCard): string {
      const { card, clonePath } = runnable;
      const worktreePath = `${clonePath}-${card.identifier.toLowerCase()}`;
      if (ownWorktrees.has(worktreePath)) return worktreePath;
      if (exists(worktreePath)) {
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
      git(worktreePath, ["config", "--worktree", "core.hooksPath", hooksDir]);
      ownWorktrees.add(worktreePath);
      return worktreePath;
    },
  };
}
