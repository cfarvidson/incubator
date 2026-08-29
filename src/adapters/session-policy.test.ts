import { describe, expect, it } from "vitest";
import { card } from "../core/test-fixtures.js";
import { cardSessionPolicy } from "./session-policy.js";
import type { RunnableCard } from "../core/types.js";

function runnable(): RunnableCard {
  return {
    card: card({ identifier: "CFA-7", title: "Fix the thing", branchName: "cfa-7-fix-the-thing" }),
    repo: "cfarvidson/example",
    clonePath: "/clones/example",
  };
}

describe("cardSessionPolicy", () => {
  it("writes a session prompt naming the Card, the repo, the branch, and carrying the Brief", () => {
    const prompt = cardSessionPolicy.prompt(runnable());

    expect(prompt).toContain("CFA-7: Fix the thing");
    expect(prompt).toContain("worktree of cfarvidson/example on branch cfa-7-fix-the-thing");
    expect(prompt).toContain("## Acceptance criteria");
    expect(prompt).toContain("git push -u origin cfa-7-fix-the-thing");
    expect(prompt).toContain("mentioning CFA-7 in the PR body");
  });

  it("builds CLI args with the prompt, streaming output, and both tool lists", () => {
    const args = cardSessionPolicy.cliArgs(runnable(), null);

    expect(args.slice(0, 2)).toEqual(["-p", cardSessionPolicy.prompt(runnable())]);
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(cardSessionPolicy.allowedTools.join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(cardSessionPolicy.disallowedTools.join(","));
  });

  it("passes --model only when a model is configured", () => {
    expect(cardSessionPolicy.cliArgs(runnable(), "claude-sonnet-5")).toContain("--model");
    expect(cardSessionPolicy.cliArgs(runnable(), null)).not.toContain("--model");
  });

  it("denies the destructive git and gh escapes, in depth behind the pre-push hook", () => {
    expect(cardSessionPolicy.disallowedTools).toContain("Bash(git push --force:*)");
    expect(cardSessionPolicy.disallowedTools).toContain("Bash(gh pr merge:*)");
    expect(cardSessionPolicy.hooksDir.endsWith("/hooks")).toBe(true);
  });
});
