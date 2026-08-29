import { describe, expect, it } from "vitest";
import { card } from "./test-fixtures.js";
import { bounceReasons } from "./brief.js";
import { RateLimitError } from "./rate-limit.js";
import { runNight } from "./run.js";
import type { Card, CardSessionResult, MorningReport, Plan, RunDeps, RunnableCard } from "./types.js";

interface HarnessOptions {
  sessionResult?: (r: RunnableCard) => CardSessionResult;
  confirm?: (plan: Plan) => Promise<boolean>;
  now?: () => Date;
  fetchNightQueue?: () => Promise<Card[]>;
  stranded?: Card[];
  interruption?: RunDeps["interruption"];
}

/** A hand-fired InterruptionPort: `interrupt()` is the test's Ctrl+C. */
function manualInterruption() {
  let flag = false;
  let fire!: () => void;
  const when = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return {
    port: { interrupted: () => flag, whenInterrupted: () => when },
    interrupt: () => {
      flag = true;
      fire();
    },
  };
}

function harness(cards: Card[], { sessionResult, confirm, now, fetchNightQueue, stranded, interruption }: HarnessOptions = {}) {
  const events: string[] = [];
  const reports: MorningReport[] = [];
  const logLines: string[] = [];
  const deps: RunDeps = {
    confirm: confirm ?? (async () => true),
    clock: {
      now: now ?? (() => new Date("2026-01-05T22:00:00")),
      sleep: async (ms) => {
        events.push(`sleep ${ms}`);
      },
    },
    linear: {
      fetchNightQueue: fetchNightQueue ?? (async () => cards),
      fetchStranded: async () => stranded ?? [],
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
    interruption: interruption ?? { interrupted: () => false, whenInterrupted: () => new Promise(() => {}) },
    executor: {
      execute: async (r) => {
        events.push(`execute ${r.card.identifier}`);
        return sessionResult?.(r) ?? { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
      },
    },
    runLog: {
      log: (message) => {
        logLines.push(message);
      },
    },
    morningReport: {
      // Snapshot: runNight mutates one report object across its incremental writes.
      write: async (report) => {
        reports.push(structuredClone(report));
      },
    },
  };
  return { deps, events, reports, logLines };
}

describe("runNight", () => {
  it("works a multi-Card queue sequentially in priority order, mixed outcomes, one report", async () => {
    const { deps, events, reports } = harness(
      [
        card({ identifier: "CFA-60", priority: 4 }),
        card({ identifier: "CFA-61", priority: 1 }),
        card({ identifier: "CFA-62", priority: 2 }),
      ],
      {
        sessionResult: (r) =>
          r.card.identifier === "CFA-62"
            ? { kind: "failure", reason: "Card Session for CFA-62 exited with status 1" }
            : { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-61",
      "execute CFA-61",
      "in-review CFA-61 https://github.com/cfarvidson/example/pull/1",
      "claim CFA-62",
      "execute CFA-62",
      "bounce CFA-62: Card Session for CFA-62 exited with status 1",
      "claim CFA-60",
      "execute CFA-60",
      "in-review CFA-60 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.ran.map((r) => r.card.identifier)).toEqual(["CFA-61", "CFA-60"]);
    expect(report?.bounced.map((b) => b.card.identifier)).toEqual(["CFA-62"]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("starts no new Card after the Stop Time; the in-flight Card finishes and the rest are reported", async () => {
    let now = new Date("2026-01-05T22:00:00");
    const { deps, events, reports } = harness(
      [
        card({ identifier: "CFA-70", priority: 1 }),
        card({ identifier: "CFA-71", priority: 2 }),
        card({ identifier: "CFA-72", priority: 3 }),
      ],
      {
        now: () => now,
        sessionResult: (r) => {
          if (r.card.identifier === "CFA-70") now = new Date("2026-01-06T07:30:00");
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-70",
      "execute CFA-70",
      "in-review CFA-70 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.notStarted.map((c) => c.identifier)).toEqual(["CFA-71", "CFA-72"]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("uses the same-day Stop Time when the run starts after midnight", async () => {
    let now = new Date("2026-01-06T06:59:00");
    const { deps, events } = harness(
      [card({ identifier: "CFA-73", priority: 1 }), card({ identifier: "CFA-74", priority: 2 })],
      {
        now: () => now,
        sessionResult: (r) => {
          if (r.card.identifier === "CFA-73") now = new Date("2026-01-06T07:01:00");
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-73",
      "execute CFA-73",
      "in-review CFA-73 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.notStarted.map((c) => c.identifier)).toEqual(["CFA-74"]);
  });

  it("runs nothing when the abort prompt is declined: no Linear writes, no sessions, no report", async () => {
    const { deps, events, reports } = harness(
      [card({ identifier: "CFA-50" }), card({ identifier: "CFA-51", brief: "no repo line here" })],
      { confirm: async () => false },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(report).toBeNull();
    expect(events).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("shows the confirm prompt the full Plan, runnable and bounced", async () => {
    const plans: Plan[] = [];
    const { deps } = harness([card({ identifier: "CFA-52" }), card({ identifier: "CFA-53", brief: "no repo line here" })], {
      confirm: async (plan) => {
        plans.push(plan);
        return false;
      },
    });
    await runNight(deps, { stopTime: "07:00" });

    expect(plans).toHaveLength(1);
    expect(plans[0]!.runnable.map((r) => r.card.identifier)).toEqual(["CFA-52"]);
    expect(plans[0]!.bounced.map((b) => b.card.identifier)).toEqual(["CFA-53"]);
  });

  it("executes nothing when no Card is runnable, but still writes the report with the bounced", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-22", brief: "no repo line here" })]);
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([`bounce CFA-22: ${bounceReasons.noRepoLine}`]);
    expect(report?.ran).toEqual([]);
    expect(report?.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-22" }), reason: expect.stringContaining("Repo Line") },
    ]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("bounces a Plan-time invalid Card in Linear before any session starts", async () => {
    const { deps, events } = harness([
      card({ identifier: "CFA-30", brief: "no repo line here", priority: 1 }),
      card({ identifier: "CFA-31", priority: 2 }),
    ]);
    await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      `bounce CFA-30: ${bounceReasons.noRepoLine}`,
      "claim CFA-31",
      "execute CFA-31",
      "in-review CFA-31 https://github.com/cfarvidson/example/pull/1",
    ]);
  });

  it("waits and retries with doubling backoff (capped) when the Card Session reports rate limiting", async () => {
    let attempts = 0;
    const { deps, events } = harness([card({ identifier: "CFA-80" })], {
      sessionResult: (r) => {
        attempts += 1;
        if (attempts <= 5) return { kind: "rate-limited" };
        return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
      },
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-80",
      "execute CFA-80",
      "sleep 60000",
      "execute CFA-80",
      "sleep 120000",
      "execute CFA-80",
      "sleep 240000",
      "execute CFA-80",
      "sleep 480000",
      "execute CFA-80",
      "sleep 900000",
      "execute CFA-80",
      "in-review CFA-80 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.ran.map((r) => r.card.identifier)).toEqual(["CFA-80"]);
  });

  it("waits and retries when the Linear API reports rate limiting, then continues the night", async () => {
    let fetches = 0;
    const queued = [card({ identifier: "CFA-81" })];
    const { deps, events } = harness(queued, {
      fetchNightQueue: async () => {
        fetches += 1;
        if (fetches === 1) throw new RateLimitError("Linear API rate limited");
        return queued;
      },
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "sleep 60000",
      "claim CFA-81",
      "execute CFA-81",
      "in-review CFA-81 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.ran.map((r) => r.card.identifier)).toEqual(["CFA-81"]);
  });

  it("stops retrying a rate-limited Card once the Stop Time passes, and Bounces it", async () => {
    let now = new Date("2026-01-06T06:50:00");
    const { deps, events, reports } = harness(
      [card({ identifier: "CFA-82", priority: 1 }), card({ identifier: "CFA-83", priority: 2 })],
      {
        now: () => now,
        sessionResult: (r) => {
          if (r.card.identifier === "CFA-82") {
            now = new Date("2026-01-06T07:10:00");
            return { kind: "rate-limited" };
          }
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-82",
      "execute CFA-82",
      "bounce CFA-82: Card Session for CFA-82 was rate limited and the Stop Time passed before it could be retried",
    ]);
    expect(report?.bounced.map((b) => b.card.identifier)).toEqual(["CFA-82"]);
    expect(report?.notStarted.map((c) => c.identifier)).toEqual(["CFA-83"]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("handles an empty Night Queue: no Linear writes, no sessions, the report still lands", async () => {
    const { deps, events, reports } = harness([]);
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([]);
    expect(report).toEqual({ ran: [], bounced: [], excluded: [], notStarted: [] });
    expect(reports.at(-1)).toEqual(report);
  });

  it("touches an excluded Card in no way: no claim, no bounce, no comment, no session", async () => {
    const { deps, events, reports, logLines } = harness([
      card({ identifier: "CFA-96", teamHasNeedsInfo: false, priority: 1 }),
      card({ identifier: "CFA-97", priority: 2 }),
    ]);
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-97",
      "execute CFA-97",
      "in-review CFA-97 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.excluded).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-96" }),
        reason: "Team not onboarded: it has no `needs-info` label, so a Bounce cannot land",
      },
    ]);
    expect(logLines).toContain(
      "Excluded CFA-96 (no Linear writes): Team not onboarded: it has no `needs-info` label, so a Bounce cannot land",
    );
    expect(reports.at(-1)).toEqual(report);
  });

  it("bounces a Card whose session fails, and never marks it In Review", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-40" })], {
      sessionResult: () => ({ kind: "failure", reason: "Card Session for CFA-40 exited with status 1" }),
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-40",
      "execute CFA-40",
      "bounce CFA-40: Card Session for CFA-40 exited with status 1",
    ]);
    expect(report?.ran).toEqual([]);
    expect(report?.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-40" }),
        reason: "Card Session for CFA-40 exited with status 1",
        durationMs: 0,
        timedOut: false,
      },
    ]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("bounces a Card whose executor throws, and the night continues with the next Card", async () => {
    const { deps, events, reports } = harness(
      [card({ identifier: "CFA-90", priority: 1 }), card({ identifier: "CFA-91", priority: 2 })],
      {
        sessionResult: (r) => {
          if (r.card.identifier === "CFA-90") throw new Error("worktree /clones/example-cfa-90 already exists");
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-90",
      "execute CFA-90",
      "bounce CFA-90: worktree /clones/example-cfa-90 already exists",
      "claim CFA-91",
      "execute CFA-91",
      "in-review CFA-91 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.crashReason).toBeUndefined();
    expect(report?.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-90" }),
        reason: "worktree /clones/example-cfa-90 already exists",
        durationMs: 0,
        timedOut: false,
      },
    ]);
    expect(report?.ran.map((r) => r.card.identifier)).toEqual(["CFA-91"]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("records each Card's wall-clock duration in the report; Plan-time Bounces have none", async () => {
    let t = new Date("2026-01-05T22:00:00").getTime();
    const { deps } = harness(
      [
        card({ identifier: "CFA-90", priority: 1 }),
        card({ identifier: "CFA-91", priority: 2 }),
        card({ identifier: "CFA-92", priority: 3, brief: "no repo line here" }),
      ],
      {
        now: () => new Date(t),
        sessionResult: (r) => {
          if (r.card.identifier === "CFA-90") {
            t += 45 * 60_000;
            return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
          }
          t += 30 * 60_000;
          return { kind: "timeout", reason: "Card Session for CFA-91 hit the 2h Duration Cap and was stopped" };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(report?.ran).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-90" }), prUrls: [expect.any(String)], durationMs: 45 * 60_000 },
    ]);
    expect(report?.bounced).toEqual([
      { card: expect.objectContaining({ identifier: "CFA-92" }), reason: expect.stringContaining("Repo Line") },
      {
        card: expect.objectContaining({ identifier: "CFA-91" }),
        reason: expect.stringContaining("Duration Cap"),
        durationMs: 30 * 60_000,
        timedOut: true,
      },
    ]);
  });

  it("writes a run log detailed enough to reconstruct the night", async () => {
    let attempts = 0;
    const { deps, logLines } = harness(
      [card({ identifier: "CFA-31", priority: 1 }), card({ identifier: "CFA-30", priority: 2, brief: "no repo line here" })],
      {
        sessionResult: (r) => {
          attempts += 1;
          if (attempts === 1) return { kind: "rate-limited" };
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    await runNight(deps, { stopTime: "07:00", claudeProfile: "wclaude" });

    expect(logLines).toEqual([
      "Night Run started (Claude Profile wclaude): 1 runnable, 1 Bounced at Plan time; Stop Time 07:00",
      `Bounced CFA-30 at Plan time: ${bounceReasons.noRepoLine}`,
      "Claimed CFA-31; Card Session starting",
      "Rate limited; waiting 1m before retrying",
      "CFA-31 done in 0m: https://github.com/cfarvidson/example/pull/1",
      "Night Run finished: 1 done, 1 Bounced, 0 not started; Morning Report written",
    ]);
  });

  it("logs a fatal error before rethrowing, so the run log never ends mid-mystery", async () => {
    const { deps, logLines } = harness([card({ identifier: "CFA-95" })]);
    deps.linear.claim = async () => {
      throw new Error("Linear API error: issue not found");
    };

    await expect(runNight(deps, { stopTime: "07:00" })).rejects.toThrow("issue not found");
    expect(logLines.at(-1)).toBe("Night Run crashed: Linear API error: issue not found");
  });

  it("logs nothing when the abort prompt is declined", async () => {
    const { deps, logLines } = harness([card({ identifier: "CFA-50" })], { confirm: async () => false });
    await runNight(deps, { stopTime: "07:00" });

    expect(logLines).toEqual([]);
  });

  it("bounces a Card whose session hits the duration cap, with the timeout comment", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-41" })], {
      sessionResult: () => ({ kind: "timeout", reason: "Card Session for CFA-41 hit the 2h duration cap and was stopped" }),
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-41",
      "execute CFA-41",
      "bounce CFA-41: Card Session for CFA-41 hit the 2h duration cap and was stopped",
    ]);
    expect(report?.ran).toEqual([]);
    expect(report?.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-41" }),
        reason: expect.stringContaining("hit the 2h duration cap"),
        durationMs: 0,
        timedOut: true,
      },
    ]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("bounces the in-flight Card on interruption, lands the report, and reports the rest as not started", async () => {
    const { deps, events, reports, logLines } = harness(
      [card({ identifier: "CFA-110", priority: 1 }), card({ identifier: "CFA-111", priority: 2 })],
      { sessionResult: () => ({ kind: "interrupted" }) },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-110",
      "execute CFA-110",
      "bounce CFA-110: interrupted by user during Night Run",
    ]);
    expect(report?.interrupted).toBe(true);
    expect(report?.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-110" }),
        reason: "interrupted by user during Night Run",
        durationMs: 0,
        timedOut: false,
      },
    ]);
    // The queue behind the interrupted Card was never Claimed; the morning must still account for it.
    expect(report?.notStarted.map((c) => c.identifier)).toEqual(["CFA-111"]);
    // The Morning Report landed, with the interruption in it.
    expect(reports.at(-1)).toEqual(report);
    expect(logLines).toContain("Interrupted by user; CFA-111 not started");
    expect(logLines.at(-1)).toBe(
      "Night Run interrupted by user: 0 done, 1 Bounced, 1 not started; Morning Report written",
    );
  });

  it("winds down on Ctrl+C between Cards: the finished Card lands, the rest are not started, nothing more is Claimed", async () => {
    const { port, interrupt } = manualInterruption();
    const { deps, events, reports } = harness(
      [card({ identifier: "CFA-112", priority: 1 }), card({ identifier: "CFA-113", priority: 2 })],
      {
        interruption: port,
        sessionResult: (r) => {
          interrupt(); // Ctrl+C arrives while CFA-112's session runs to completion
          return { kind: "success", prUrls: [`https://github.com/${r.repo}/pull/1`] };
        },
      },
    );
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-112",
      "execute CFA-112",
      "in-review CFA-112 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.interrupted).toBe(true);
    expect(report?.ran.map((r) => r.card.identifier)).toEqual(["CFA-112"]);
    expect(report?.notStarted.map((c) => c.identifier)).toEqual(["CFA-113"]);
    expect(reports.at(-1)).toEqual(report);
  });

  it("cuts a Backoff wait short on Ctrl+C and Bounces the in-flight Card as interrupted", async () => {
    const { port, interrupt } = manualInterruption();
    const { deps, events } = harness([card({ identifier: "CFA-114" })], {
      interruption: port,
      sessionResult: () => {
        interrupt(); // Ctrl+C arrives during the Backoff wait that follows
        return { kind: "rate-limited" };
      },
    });
    // A real Backoff wait is minutes long; only the interruption may end it here.
    deps.clock = { now: deps.clock.now, sleep: () => new Promise(() => {}) };
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-114",
      "execute CFA-114",
      "bounce CFA-114: interrupted by user during Night Run",
    ]);
    expect(report?.interrupted).toBe(true);
  });

  it("reports an executor error during Ctrl+C as interrupted, not as a session failure", async () => {
    const { port, interrupt } = manualInterruption();
    const { deps, events } = harness([card({ identifier: "CFA-115" })], {
      interruption: port,
      sessionResult: () => {
        interrupt(); // Ctrl+C killed the executor's git/gh child mid-setup
        throw new Error("gh pr list was killed by SIGINT");
      },
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "claim CFA-115",
      "execute CFA-115",
      "bounce CFA-115: interrupted by user during Night Run",
    ]);
    expect(report?.interrupted).toBe(true);
  });

  it("never starts the night when Ctrl+C arrives during planning: no prompt, no writes", async () => {
    const { port, interrupt } = manualInterruption();
    interrupt();
    const confirms: Plan[] = [];
    const { deps, events, reports } = harness([card({ identifier: "CFA-116" })], {
      interruption: port,
      confirm: async (plan) => {
        confirms.push(plan);
        return true;
      },
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(report).toBeNull();
    expect(confirms).toEqual([]);
    expect(events).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("writes the Morning Report incrementally: after Plan-time Bounces and after every Card outcome", async () => {
    const { deps, reports } = harness([
      card({ identifier: "CFA-100", priority: 1 }),
      card({ identifier: "CFA-101", priority: 2 }),
    ]);
    await runNight(deps, { stopTime: "07:00" });

    // Plan-time write, one per Card, and the finally-write; a hard kill loses at most the Card in flight.
    expect(reports.map((r) => r.ran.map((entry) => entry.card.identifier))).toEqual([
      [],
      ["CFA-100"],
      ["CFA-100", "CFA-101"],
      ["CFA-100", "CFA-101"],
    ]);
  });

  it("lands the Morning Report on a crash, with the outcomes so far and the crash reason", async () => {
    const { deps, reports } = harness([
      card({ identifier: "CFA-102", priority: 1 }),
      card({ identifier: "CFA-103", priority: 2 }),
    ]);
    let calls = 0;
    deps.linear.markInReview = async () => {
      calls += 1;
      if (calls === 2) throw new Error("Linear API error: boom");
    };

    await expect(runNight(deps, { stopTime: "07:00" })).rejects.toThrow("boom");
    const last = reports.at(-1);
    expect(last?.crashReason).toBe("Linear API error: boom");
    expect(last?.ran.map((entry) => entry.card.identifier)).toEqual(["CFA-102"]);
  });

  it("bounces a Stranded Card at Plan time, before the queue is worked", async () => {
    const { deps, events, reports } = harness([card({ identifier: "CFA-104" })], {
      stranded: [card({ identifier: "CFA-99" })],
    });
    const report = await runNight(deps, { stopTime: "07:00" });

    expect(events).toEqual([
      "bounce CFA-99: Stranded: Claimed by an earlier Night Run that never finished",
      "claim CFA-104",
      "execute CFA-104",
      "in-review CFA-104 https://github.com/cfarvidson/example/pull/1",
    ]);
    expect(report?.bounced).toEqual([
      {
        card: expect.objectContaining({ identifier: "CFA-99" }),
        reason: "Stranded: Claimed by an earlier Night Run that never finished",
      },
    ]);
    expect(reports.at(-1)).toEqual(report);
  });
});
