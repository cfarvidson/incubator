import { describe, expect, it } from "vitest";
import { card } from "../core/test-fixtures.js";
import { RateLimitError } from "../core/rate-limit.js";
import { CLAIM_COMMENT } from "./claim-marker.js";
import { branchNameFor, makeGithubPort, priorityFromLabels, type GhRunner } from "./github.js";

const ISSUE = {
  title: "Fix the thing",
  body: "Repo: cfarvidson/example\n\n## Goal\nDo it.\n\n## Verification\nRun it.",
  url: "https://github.com/cfarvidson/example/issues/7",
  number: 7,
  labels: [{ name: "ready-for-agent" }, { name: "priority:high" }],
  repository: { nameWithOwner: "cfarvidson/example" },
};

/** A fake gh: canned stdout per subcommand, every invocation recorded. */
function fakeGh(responses: Record<string, string | ((args: string[]) => string)>) {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const response = responses[key];
    if (response === undefined) throw new Error(`fake gh has no response for "${key}"`);
    return typeof response === "function" ? response(args) : response;
  };
  return { gh, calls };
}

describe("priorityFromLabels", () => {
  it("maps priority:* labels onto Linear's scale, most urgent winning, none for unlabeled", () => {
    expect(priorityFromLabels(["bug", "priority:high"])).toBe(2);
    expect(priorityFromLabels(["priority:low", "Priority:Urgent"])).toBe(1);
    expect(priorityFromLabels(["bug"])).toBe(0);
    expect(priorityFromLabels([])).toBe(0);
  });
});

describe("branchNameFor", () => {
  it("builds a night/ branch from the issue number and a slug of the title", () => {
    expect(branchNameFor(7, "Fix the thing")).toBe("night/7-fix-the-thing");
    expect(branchNameFor(7, "Åtgärda #7: CI!!")).toBe("night/7-tg-rda-7-ci");
    expect(branchNameFor(7, "!!!")).toBe("night/7");
  });

  it("caps the slug without leaving a trailing dash", () => {
    const name = branchNameFor(9, "a".repeat(39) + " and more words here");
    expect(name.length).toBeLessThanOrEqual("night/9-".length + 40);
    expect(name.endsWith("-")).toBe(false);
  });
});

describe("makeGithubPort", () => {
  it("fetches the Night Queue: open + mine + ready-for-agent, not yet Claimed, within the scope", async () => {
    const { gh, calls } = fakeGh({
      "search issues": JSON.stringify([ISSUE]),
      "label list": JSON.stringify([{ name: "needs-info" }]),
    });
    const cards = await makeGithubPort(["cfarvidson"], gh).fetchNightQueue();

    const searchArgs = calls[0]!;
    expect(searchArgs).toEqual(expect.arrayContaining(["--assignee", "@me", "--label", "ready-for-agent"]));
    expect(searchArgs).toEqual(expect.arrayContaining(["--owner", "cfarvidson"]));
    expect(searchArgs.slice(-2)).toEqual(["--", "-label:in-progress"]);
    expect(cards).toEqual([
      {
        identifier: "cfarvidson/example#7",
        title: "Fix the thing",
        brief: ISSUE.body,
        priority: 2,
        url: ISSUE.url,
        branchName: "night/7-fix-the-thing",
        canBounce: true,
        homeRepo: "cfarvidson/example",
      },
    ]);
  });

  it("searches each scope entry with its own query and unions the results (GitHub ANDs qualifiers)", async () => {
    const elsewhere = {
      ...ISSUE,
      number: 3,
      url: "https://github.com/other/tool/issues/3",
      repository: { nameWithOwner: "other/tool" },
    };
    const { gh, calls } = fakeGh({
      "search issues": (args) => JSON.stringify(args.includes("--owner") ? [ISSUE] : [ISSUE, elsewhere]),
      "label list": JSON.stringify([{ name: "needs-info" }]),
    });
    const cards = await makeGithubPort(["cfarvidson", "other/tool"], gh).fetchNightQueue();

    const searches = calls.filter((c) => c[0] === "search");
    expect(searches).toHaveLength(2);
    expect(searches[0]).toEqual(expect.arrayContaining(["--owner", "cfarvidson"]));
    expect(searches[1]).toEqual(expect.arrayContaining(["--repo", "other/tool"]));
    expect(searches[0]).not.toEqual(expect.arrayContaining(["--repo"]));
    // The overlapping issue appears once; the union carries both repos' Cards.
    expect(cards.map((c) => c.identifier).sort()).toEqual(["cfarvidson/example#7", "other/tool#3"]);
  });

  it("marks a Card from a repo without a needs-info label as unable to Bounce", async () => {
    const { gh } = fakeGh({
      "search issues": JSON.stringify([ISSUE]),
      "label list": JSON.stringify([{ name: "bug" }]),
    });
    const cards = await makeGithubPort(["cfarvidson"], gh).fetchNightQueue();
    expect(cards[0]!.canBounce).toBe(false);
  });

  it("finds Stranded Cards: Claimed (in-progress) with the Claim as the latest Night Run comment", async () => {
    const strandedIssue = { ...ISSUE, number: 8, url: "https://github.com/cfarvidson/example/issues/8" };
    const { gh, calls } = fakeGh({
      "search issues": JSON.stringify([ISSUE, strandedIssue]),
      "label list": JSON.stringify([{ name: "needs-info" }]),
      "issue view": (args) =>
        args.includes(strandedIssue.url)
          ? JSON.stringify({ comments: [{ body: CLAIM_COMMENT, createdAt: "2026-08-28T22:00:00Z" }] })
          : JSON.stringify({
              comments: [
                { body: CLAIM_COMMENT, createdAt: "2026-08-28T22:00:00Z" },
                { body: "Night Run result: done.", createdAt: "2026-08-28T23:00:00Z" },
              ],
            }),
    });
    const cards = await makeGithubPort(["cfarvidson"], gh).fetchStranded();

    expect(calls[0]!.slice(-2)).toEqual(["--", "label:in-progress"]);
    expect(cards.map((c) => c.identifier)).toEqual(["cfarvidson/example#8"]);
  });

  it("claims a Card: in-progress label (created if missing) plus the Claim comment", async () => {
    const { gh, calls } = fakeGh({ "label create": "", "issue edit": "", "issue comment": "" });
    await makeGithubPort(["cfarvidson"], gh).claim(card({ url: ISSUE.url, homeRepo: "cfarvidson/example" }));

    expect(calls).toEqual([
      ["label", "create", "in-progress", "-R", "cfarvidson/example", "--color", "ededed"],
      ["issue", "edit", ISSUE.url, "--add-label", "in-progress"],
      ["issue", "comment", ISSUE.url, "--body", CLAIM_COMMENT],
    ]);
  });

  it("marks a Card in review: swaps the queue labels for in-review and links the PRs", async () => {
    const { gh, calls } = fakeGh({ "label create": "", "issue edit": "", "issue comment": "" });
    await makeGithubPort(["cfarvidson"], gh).markInReview(card({ url: ISSUE.url, homeRepo: "cfarvidson/example" }), [
      "https://github.com/cfarvidson/example/pull/12",
    ]);

    expect(calls).toEqual([
      ["label", "create", "in-review", "-R", "cfarvidson/example", "--color", "ededed"],
      ["issue", "edit", ISSUE.url, "--remove-label", "ready-for-agent,in-progress", "--add-label", "in-review"],
      [
        "issue",
        "comment",
        ISSUE.url,
        "--body",
        "Night Run result: done.\n\n- https://github.com/cfarvidson/example/pull/12",
      ],
    ]);
  });

  it("bounces a Card: ready-for-agent swapped for needs-info, with the reason as a comment", async () => {
    const { gh, calls } = fakeGh({ "label create": "", "issue edit": "", "issue comment": "" });
    await makeGithubPort(["cfarvidson"], gh).bounce(card({ url: ISSUE.url, homeRepo: "cfarvidson/example" }), "no clone");

    expect(calls.slice(1)).toEqual([
      ["issue", "edit", ISSUE.url, "--remove-label", "ready-for-agent,in-progress", "--add-label", "needs-info"],
      ["issue", "comment", ISSUE.url, "--body", "Night Run result: Bounced.\n\nno clone"],
    ]);
  });

  it("keeps claiming when the in-progress label already exists (label create fails)", async () => {
    const { gh, calls } = fakeGh({
      "label create": () => {
        throw new Error("gh label create failed: already exists");
      },
      "issue edit": "",
      "issue comment": "",
    });
    await makeGithubPort(["cfarvidson"], gh).claim(card({ url: ISSUE.url, homeRepo: "cfarvidson/example" }));
    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["label create", "issue edit", "issue comment"]);
  });

  it("lets a RateLimitError through untouched, for the Backoff to handle", async () => {
    const gh: GhRunner = async () => {
      throw new RateLimitError("GitHub API rate limited");
    };
    await expect(makeGithubPort(["cfarvidson"], gh).fetchNightQueue()).rejects.toBeInstanceOf(RateLimitError);
  });
});
