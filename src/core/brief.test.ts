import { describe, expect, it } from "vitest";
import { bounceReasons, checkBrief } from "./brief.js";

const complete = [
  "Repo: cfarvidson/example",
  "",
  "## What to build",
  "Something end-to-end.",
  "",
  "## Acceptance criteria",
  "- [ ] It works",
].join("\n");

describe("checkBrief", () => {
  it("returns the target repo for a complete Brief", () => {
    expect(checkBrief(complete)).toEqual({ runnable: true, repo: "cfarvidson/example" });
  });

  it("rejects a Brief without a Repo Line", () => {
    expect(checkBrief("## What to build\nStuff.\n\n## Acceptance criteria\n- [ ] Done")).toEqual({
      runnable: false,
      reason: bounceReasons.noRepoLine,
    });
  });

  it("falls back to the home repo when the Brief has no Repo Line", () => {
    expect(checkBrief("## Goal\nDo it.\n\n## Verification\nRun it.", "cfarvidson/example")).toEqual({
      runnable: true,
      repo: "cfarvidson/example",
    });
  });

  it("lets an explicit Repo Line outrank the home repo", () => {
    expect(checkBrief(complete, "cfarvidson/other")).toEqual({ runnable: true, repo: "cfarvidson/example" });
  });

  it("rejects a Repo Line that is not owner/name", () => {
    expect(checkBrief("Repo: just-a-name\n\n## Goal\nDo it.\n\n## Verification\nRun it.")).toEqual({
      runnable: false,
      reason: bounceReasons.noRepoLine,
    });
  });

  it("rejects a Brief without a goal section", () => {
    expect(checkBrief("Repo: cfarvidson/example\n\n## Acceptance criteria\n- [ ] Done")).toEqual({
      runnable: false,
      reason: bounceReasons.noGoal,
    });
  });

  it("rejects a Brief without verification steps", () => {
    expect(checkBrief("Repo: cfarvidson/example\n\n## What to build\nStuff.")).toEqual({
      runnable: false,
      reason: bounceReasons.noVerification,
    });
  });

  it("accepts alternate goal and verification headings", () => {
    const alt = "Repo: cfarvidson/example\n\n## Goal\nDo it.\n\n## Verification\nRun the thing and see it work.";
    expect(checkBrief(alt)).toEqual({ runnable: true, repo: "cfarvidson/example" });
  });

  it("accepts a `- [ ]` checklist as verification without a heading", () => {
    const checklist = "Repo: cfarvidson/example\n\n## Problem\nIt is broken.\n\n- [ ] Not broken anymore";
    expect(checkBrief(checklist)).toEqual({ runnable: true, repo: "cfarvidson/example" });
  });
});
