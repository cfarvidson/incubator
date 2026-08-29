import { describe, expect, it } from "vitest";
import { card } from "../core/test-fixtures.js";
import { linearSessionHints } from "./linear.js";
import { githubSessionHints } from "./github.js";
import { cardSessionPolicy } from "./session-policy.js";
import type { RunnableCard } from "../core/types.js";
import type { HarnessProfile } from "../harness.js";

function runnable(): RunnableCard {
  return {
    card: card({ identifier: "CFA-7", title: "Fix the thing", branchName: "cfa-7-fix-the-thing" }),
    repo: "cfarvidson/example",
    clonePath: "/clones/example",
  };
}

function harness(overrides: Partial<HarnessProfile> = {}): HarnessProfile {
  return { name: "dclaude", kind: "claude", command: "claude", env: {}, model: null, args: null, ...overrides };
}

describe("cardSessionPolicy", () => {
  it("writes a session prompt naming the Card, the repo, the branch, and carrying the Brief", () => {
    const prompt = cardSessionPolicy.prompt(runnable(), linearSessionHints);

    expect(prompt).toContain("CFA-7: Fix the thing");
    expect(prompt).toContain("worktree of cfarvidson/example on branch cfa-7-fix-the-thing");
    expect(prompt).toContain("## Acceptance criteria");
    expect(prompt).toContain("git push -u origin cfa-7-fix-the-thing");
    expect(prompt).toContain("mentioning CFA-7 in the PR body");
  });

  it("tells the session how to comment on its Card per the active tracker", () => {
    expect(cardSessionPolicy.prompt(runnable(), linearSessionHints)).toContain(
      "you may add a comment to it via the linear-work save_comment tool",
    );
    expect(cardSessionPolicy.prompt(runnable(), githubSessionHints)).toContain(
      "you may add a comment to it with `gh issue comment https://linear.app/tv4/issue/CFA-1`",
    );
  });

  it("allows the tracker's comment tool on top of the base list", () => {
    expect(cardSessionPolicy.allowedTools(linearSessionHints)).toContain("mcp__linear-work__save_comment");
    expect(cardSessionPolicy.allowedTools(githubSessionHints)).not.toContain("mcp__linear-work__save_comment");
    expect(cardSessionPolicy.allowedTools(githubSessionHints)).toContain("Bash");
  });

  it("builds claude CLI args with the prompt, streaming output, and both tool lists", () => {
    const args = cardSessionPolicy.cliArgs(runnable(), harness(), linearSessionHints);

    expect(args.slice(0, 2)).toEqual(["-p", cardSessionPolicy.prompt(runnable(), linearSessionHints)]);
    expect(args).toContain("stream-json");
    expect(args).toContain("--verbose");
    expect(args[args.indexOf("--allowedTools") + 1]).toBe(cardSessionPolicy.allowedTools(linearSessionHints).join(","));
    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(cardSessionPolicy.disallowedTools.join(","));
  });

  it("passes --model only when the Harness Profile carries a model", () => {
    expect(cardSessionPolicy.cliArgs(runnable(), harness({ model: "claude-opus-5" }), linearSessionHints)).toContain(
      "--model",
    );
    expect(cardSessionPolicy.cliArgs(runnable(), harness(), linearSessionHints)).not.toContain("--model");
  });

  it("builds codex args: exec, worktree sandbox with network, prompt last", () => {
    const codex = harness({ name: "wcodex", kind: "codex", command: "wcodex" });
    const args = cardSessionPolicy.cliArgs(runnable(), codex, githubSessionHints);

    expect(args[0]).toBe("exec");
    expect(args).toEqual(expect.arrayContaining(["--sandbox", "workspace-write"]));
    expect(args).toEqual(expect.arrayContaining(["-c", "sandbox_workspace_write.network_access=true"]));
    expect(args.at(-1)).toBe(cardSessionPolicy.prompt(runnable(), githubSessionHints));
    expect(args).not.toContain("--allowedTools");

    const withModel = cardSessionPolicy.cliArgs(runnable(), { ...codex, model: "gpt-5.5-codex" }, githubSessionHints);
    expect(withModel[withModel.indexOf("--model") + 1]).toBe("gpt-5.5-codex");
  });

  it("substitutes the prompt into a custom args template, which outranks the kind's shape", () => {
    const grok = harness({ name: "grok", kind: "custom", command: "grok", args: ["-p", "{prompt}"] });
    expect(cardSessionPolicy.cliArgs(runnable(), grok, githubSessionHints)).toEqual([
      "-p",
      cardSessionPolicy.prompt(runnable(), githubSessionHints),
    ]);
    // Also on claude: a template replaces the built-in argument shape entirely.
    const templated = harness({ args: ["--headless", "{prompt}"] });
    expect(cardSessionPolicy.cliArgs(runnable(), templated, linearSessionHints)).toEqual([
      "--headless",
      cardSessionPolicy.prompt(runnable(), linearSessionHints),
    ]);
  });

  it("denies the destructive git and gh escapes, in depth behind the pre-push hook", () => {
    expect(cardSessionPolicy.disallowedTools).toContain("Bash(git push --force:*)");
    expect(cardSessionPolicy.disallowedTools).toContain("Bash(gh pr merge:*)");
    expect(cardSessionPolicy.hooksDir.endsWith("/hooks")).toBe(true);
  });
});
