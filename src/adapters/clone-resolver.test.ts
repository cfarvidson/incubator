import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeCloneResolver } from "./clone-resolver.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "clone-resolver-"));
  roots.push(root);
  return root;
}

function addClone(root: string, dirName: string, originUrl: string): void {
  const gitDir = join(root, dirName, ".git");
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(
    join(gitDir, "config"),
    [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "origin"]',
      `\turl = ${originUrl}`,
      "\tfetch = +refs/heads/*:refs/remotes/origin/*",
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("makeCloneResolver", () => {
  it("matches an ssh origin", () => {
    const root = makeRoot();
    addClone(root, "example", "git@github.com:cfarvidson/example.git");
    expect(makeCloneResolver([root])("cfarvidson/example")).toBe(join(root, "example"));
  });

  it("matches an https origin", () => {
    const root = makeRoot();
    addClone(root, "example", "https://github.com/cfarvidson/example.git");
    expect(makeCloneResolver([root])("cfarvidson/example")).toBe(join(root, "example"));
  });

  it("matches an origin without the .git suffix", () => {
    const root = makeRoot();
    addClone(root, "example", "https://github.com/cfarvidson/example");
    expect(makeCloneResolver([root])("cfarvidson/example")).toBe(join(root, "example"));
  });

  it("compares owner/name case-insensitively", () => {
    const root = makeRoot();
    addClone(root, "example", "git@github.com:CFArvidson/Example.git");
    expect(makeCloneResolver([root])("cfarvidson/example")).toBe(join(root, "example"));
  });

  it("does not match a clone of a fork whose origin merely contains the repo as a substring", () => {
    const root = makeRoot();
    addClone(root, "example", "git@github.com:cfarvidson/example-fork.git");
    expect(makeCloneResolver([root])("cfarvidson/example")).toBeNull();
  });

  it("searches later roots when the first has no clone", () => {
    const first = makeRoot();
    const second = makeRoot();
    addClone(second, "example", "git@github.com:cfarvidson/example.git");
    expect(makeCloneResolver([first, second])("cfarvidson/example")).toBe(join(second, "example"));
  });

  it("returns null when no root has a clone", () => {
    expect(makeCloneResolver([makeRoot()])("cfarvidson/example")).toBeNull();
  });

  it("returns null for a Repo Line without an owner", () => {
    expect(makeCloneResolver([makeRoot()])("example")).toBeNull();
  });
});
