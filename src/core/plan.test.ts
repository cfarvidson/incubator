import { describe, expect, it } from "vitest";
import { card } from "./test-fixtures.js";
import { planNight } from "./plan.js";
import type { Card, PlanDeps } from "./types.js";

function deps(cards: Card[], overrides: Partial<PlanDeps> = {}, stranded: Card[] = []): PlanDeps {
  return {
    linear: { fetchNightQueue: async () => cards, fetchStranded: async () => stranded },
    resolveClone: (repo) => `/clones/${repo.split("/")[1]}`,
    ...overrides,
  };
}

describe("planNight", () => {
  it("produces an empty Plan for an empty Night Queue", async () => {
    const plan = await planNight(deps([]));
    expect(plan).toEqual({ runnable: [], bounced: [], excluded: [] });
  });

  it("excludes a Card whose team has no needs-info label, since a Bounce could not land", async () => {
    const notOnboarded = card({ identifier: "CFA-16", teamHasNeedsInfo: false });
    const plan = await planNight(deps([notOnboarded]));
    expect(plan.runnable).toEqual([]);
    expect(plan.bounced).toEqual([]);
    expect(plan.excluded).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-16" }),
        reason: "Team not onboarded: it has no `needs-info` label, so a Bounce cannot land",
      },
    ]);
  });

  it("excludes rather than bounces when the team lacks needs-info, even if the Brief is also invalid", async () => {
    const notOnboarded = card({ identifier: "CFA-17", teamHasNeedsInfo: false, brief: "no repo line here" });
    const plan = await planNight(deps([notOnboarded]));
    expect(plan.bounced).toEqual([]);
    expect(plan.excluded.map((e) => e.card.identifier)).toEqual(["CFA-17"]);
  });

  it("plans a Card with a complete Brief as runnable, with its clone path", async () => {
    const plan = await planNight(deps([card({ identifier: "CFA-10" })]));
    expect(plan.bounced).toEqual([]);
    expect(plan.runnable).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-10" }),
        repo: "cfarvidson/example",
        clonePath: "/clones/example",
      },
    ]);
  });

  it("bounces a Card without a Repo Line", async () => {
    const noRepo = card({
      identifier: "CFA-11",
      brief: "## What to build\nStuff.\n\n## Acceptance criteria\n- [ ] Done",
    });
    const plan = await planNight(deps([noRepo]));
    expect(plan.runnable).toEqual([]);
    expect(plan.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-11" }), reason: "Brief has no Repo Line (`Repo: owner/name`)" },
    ]);
  });

  it("bounces a Card whose Repo Line has no local clone", async () => {
    const plan = await planNight(deps([card({ identifier: "CFA-12" })], { resolveClone: () => null }));
    expect(plan.runnable).toEqual([]);
    expect(plan.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-12" }),
        reason: "No local clone found for cfarvidson/example under the configured clone roots",
      },
    ]);
  });

  it("bounces a Card whose Brief has no goal section", async () => {
    const noGoal = card({
      identifier: "CFA-13",
      brief: "Repo: cfarvidson/example\n\n## Acceptance criteria\n- [ ] Done",
    });
    const plan = await planNight(deps([noGoal]));
    expect(plan.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-13" }),
        reason: "Brief has no goal section (a `What to build`, `Goal`, or `Problem` heading)",
      },
    ]);
  });

  it("bounces a Card whose Brief has no verification steps", async () => {
    const noVerify = card({
      identifier: "CFA-14",
      brief: "Repo: cfarvidson/example\n\n## What to build\nStuff.",
    });
    const plan = await planNight(deps([noVerify]));
    expect(plan.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-14" }),
        reason: "Brief has no verification steps (an `Acceptance criteria`/`Verification` heading or `- [ ]` checklist)",
      },
    ]);
  });

  it("accepts alternate goal and verification headings", async () => {
    const alt = card({
      identifier: "CFA-15",
      brief: "Repo: cfarvidson/example\n\n## Goal\nDo it.\n\n## Verification\nRun the thing and see it work.",
    });
    const plan = await planNight(deps([alt]));
    expect(plan.bounced).toEqual([]);
    expect(plan.runnable).toHaveLength(1);
  });

  it("bounces a Stranded Card, regardless of its Brief", async () => {
    const strandedCard = card({ identifier: "CFA-99", brief: "no repo line here" });
    const plan = await planNight(deps([], {}, [strandedCard]));
    expect(plan.runnable).toEqual([]);
    expect(plan.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-99" }),
        reason: "Stranded: Claimed by an earlier Night Run that never finished",
      },
    ]);
  });

  it("excludes a Stranded Card whose team lacks needs-info, since a Bounce could not land", async () => {
    const strandedCard = card({ identifier: "CFA-98", teamHasNeedsInfo: false });
    const plan = await planNight(deps([], {}, [strandedCard]));
    expect(plan.bounced).toEqual([]);
    expect(plan.excluded.map((e) => e.card.identifier)).toEqual(["CFA-98"]);
  });

  it("orders runnable Cards by Linear priority: urgent first, no-priority last", async () => {
    const plan = await planNight(
      deps([
        card({ identifier: "CFA-none", priority: 0 }),
        card({ identifier: "CFA-low", priority: 4 }),
        card({ identifier: "CFA-urgent", priority: 1 }),
        card({ identifier: "CFA-high", priority: 2 }),
      ]),
    );
    expect(plan.runnable.map((r) => r.card.identifier)).toEqual(["CFA-urgent", "CFA-high", "CFA-low", "CFA-none"]);
  });
});
