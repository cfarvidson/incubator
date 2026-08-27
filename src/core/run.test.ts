import { describe, expect, it } from "vitest";
import { card } from "./test-fixtures.js";
import { runNight } from "./run.js";
import type { Card, MorningReport, RunDeps } from "./types.js";

function harness(cards: Card[]) {
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
    },
    resolveClone: (repo) => `/clones/${repo.split("/")[1]}`,
    executor: {
      execute: async (r) => {
        events.push(`execute ${r.card.identifier}`);
        return { prUrls: [`https://github.com/${r.repo}/pull/1`] };
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

    expect(events).toEqual([]);
    expect(report.ran).toEqual([]);
    expect(report.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-22" }), reason: expect.stringContaining("Repo Line") },
    ]);
    expect(reports).toEqual([report]);
  });
});
