import { describe, expect, it } from "vitest";
import { card } from "./test-fixtures.js";
import { runNight } from "./run.js";
import type { Card, CardSessionResult, MorningReport, RunDeps, RunnableCard } from "./types.js";

function harness(cards: Card[], sessionResult?: (r: RunnableCard) => CardSessionResult) {
  const events: string[] = [];
  const reports: MorningReport[] = [];
  const deps: RunDeps = {
    linear: {
      fetchNightQueue: async () => cards,
      claim: async (c) => {
        events.push(`claim ${c.identifier}`);
      },
      markInReview: async (c, prUrls) => {
        events.push(`in-review ${c.identifier} ${prUrls.join(",")}`);
      },
      bounce: async (c, reason) => {
        events.push(`bounce ${c.identifier}: ${reason}`);
      },
    },
    resolveClone: (repo) => `/clones/${repo.split("/")[1]}`,
    executor: {
      execute: async (r) => {
        events.push(`execute ${r.card.identifier}`);
        return sessionResult?.(r) ?? { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
      },
    },
    report: {
      write: async (report) => {
        reports.push(report);
      },
    },
  };
  return { deps, events, reports };
}

describe("runNight", () => {
  it("runs the top runnable Card: claim, execute, In Review with PR links, report", async () => {
    const { deps, events, reports } = harness([
      card({ identifier: "CFA-20", priority: 2 }),
      card({ identifier: "CFA-21", priority: 4 }),
    ]);
    const report = await runNight(deps);

    expect(events).toEqual([
      "claim CFA-20",
      "execute CFA-20",
      "in-review CFA-20 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report.ran).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-20" }), prUrls: ["https://github.com/cfarvidson/example/pull/1"] },
    ]);
    expect(reports).toEqual([report]);
  });

  it("executes nothing when no Card is runnable, but still writes the report with the bounced", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-22", brief: "no repo line here" })]);
    const report = await runNight(deps);

    expect(events).toEqual(["bounce CFA-22: Brief has no Repo Line (`Repo: owner/name`)"]);
    expect(report.ran).toEqual([]);
    expect(report.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-22" }), reason: expect.stringContaining("Repo Line") },
    ]);
    expect(reports).toEqual([report]);
  });

  it("bounces a Plan-time invalid Card in Linear before any session starts", async () => {
    const { deps, events } = harness([
      card({ identifier: "CFA-30", brief: "no repo line here", priority: 1 }),
      card({ identifier: "CFA-31", priority: 2 }),
    ]);
    await runNight(deps);

    expect(events).toEqual([
      "bounce CFA-30: Brief has no Repo Line (`Repo: owner/name`)",
      "claim CFA-31",
      "execute CFA-31",
      "in-review CFA-31 https://github.com/cfarvidson/example/pull/1",
    ]);
  });

  it("bounces a Card whose session fails, and never marks it In Review", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-40" })], () => ({
      kind: "failure",
      reason: "Card Session for CFA-40 exited with status 1",
    }));
    const report = await runNight(deps);

    expect(events).toEqual([
      "claim CFA-40",
      "execute CFA-40",
      "bounce CFA-40: Card Session for CFA-40 exited with status 1",
    ]);
    expect(report.ran).toEqual([]);
    expect(report.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-40" }), reason: "Card Session for CFA-40 exited with status 1" },
    ]);
    expect(reports).toEqual([report]);
  });

  it("bounces a Card whose session hits the duration cap, with the timeout comment", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-41" })], () => ({
      kind: "timeout",
      reason: "Card Session for CFA-41 hit the 2h duration cap and was stopped",
    }));
    const report = await runNight(deps);

    expect(events).toEqual([
      "claim CFA-41",
      "execute CFA-41",
      "bounce CFA-41: Card Session for CFA-41 hit the 2h duration cap and was stopped",
    ]);
    expect(report.ran).toEqual([]);
    expect(report.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-41" }),
        reason: expect.stringContaining("hit the 2h duration cap"),
      },
    ]);
    expect(reports).toEqual([report]);
  });
});
