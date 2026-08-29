import { describe, expect, it } from "vitest";
import { card } from "../core/test-fixtures.js";
import { makeWorktrees } from "./worktree.js";
import type { RunnableCard } from "../core/types.js";

function runnable(): RunnableCard {
  return {
    card: card({ identifier: "CFA-9", branchName: "cfa-9-a-card" }),
    repo: "cfarvidson/example",
    clonePath: "/clones/example",
  };
}

function harness({ refs = ["origin/main"], existing = [] as string[] } = {}) {
  const commands: string[] = [];
  const git = (repoPath: string, args: string[]): string => {
    commands.push(`${repoPath}: ${args.join(" ")}`);
    if (args[0] === "rev-parse" && !refs.includes(args.at(-1)!)) throw new Error(`unknown ref ${args.at(-1)}`);
    return "";
  };
  const worktrees = makeWorktrees("/repo/hooks", { git, exists: (path) => existing.includes(path) });
  return { worktrees, commands };
}

describe("makeWorktrees", () => {
  it("creates a fresh worktree off origin/main with the pre-push guard installed", () => {
    const { worktrees, commands } = harness();

    expect(worktrees.ensure(runnable())).toBe("/clones/example-cfa-9");
    expect(commands).toEqual([
      "/clones/example: fetch origin",
      "/clones/example: rev-parse --verify origin/main",
      "/clones/example: worktree add -b cfa-9-a-card /clones/example-cfa-9 origin/main",
      "/clones/example: config extensions.worktreeConfig true",
      "/clones/example-cfa-9: config --worktree core.hooksPath /repo/hooks",
    ]);
  });

  it("falls back to origin/master when the repo has no origin/main", () => {
    const { worktrees, commands } = harness({ refs: ["origin/master"] });

    worktrees.ensure(runnable());
    expect(commands).toContain("/clones/example: worktree add -b cfa-9-a-card /clones/example-cfa-9 origin/master");
  });

  it("fails when the repo has neither origin/main nor origin/master", () => {
    const { worktrees } = harness({ refs: [] });

    expect(() => worktrees.ensure(runnable())).toThrow("neither origin/main nor origin/master");
  });

  it("refuses a leftover worktree from an earlier night", () => {
    const { worktrees, commands } = harness({ existing: ["/clones/example-cfa-9"] });

    expect(() => worktrees.ensure(runnable())).toThrow("Worktree already exists at /clones/example-cfa-9");
    expect(commands).toEqual([]);
  });

  it("reuses its own worktree without touching git again, so a rate-limited session can resume", () => {
    const { worktrees, commands } = harness();
    worktrees.ensure(runnable());
    const commandCount = commands.length;

    expect(worktrees.ensure(runnable())).toBe("/clones/example-cfa-9");
    expect(commands).toHaveLength(commandCount);
  });
});
