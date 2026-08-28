import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { makeCloneResolver } from "./adapters/clone-resolver.js";
import { makeCardExecutor } from "./adapters/executor.js";
import { makeLinearPort } from "./adapters/linear.js";
import { makeReportWriter, nightDateStamp } from "./adapters/report.js";
import { resolveClaudeProfile, type ClaudeProfile } from "./claude-profile.js";
import { loadConfig } from "./config.js";
import { planNight } from "./core/plan.js";
import { withRateLimitRetry } from "./core/rate-limit.js";
import { runNight } from "./core/run.js";
import type { ClockPort, Plan } from "./core/types.js";

const PRIORITY_NAMES: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

const NOTHING_TOUCHED = "No Linear writes, no sessions, no worktrees.";

function printPlan(plan: Plan, profile: ClaudeProfile | null) {
  console.log(profile ? `Tonight's Plan - Claude Profile: ${profile.name}\n` : "Tonight's Plan\n");

  if (plan.runnable.length === 0) {
    console.log("  Nothing runnable in the Night Queue.");
  } else {
    console.log(`  Would run, in order:`);
    plan.runnable.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.card.identifier} [${PRIORITY_NAMES[r.card.priority] ?? "?"}] ${r.card.title}`);
      console.log(`     ${r.repo} -> ${r.clonePath}`);
    });
  }

  if (plan.bounced.length > 0) {
    console.log(`\n  Would bounce:`);
    for (const b of plan.bounced) {
      console.log(`  - ${b.card.identifier} ${b.card.title}`);
      console.log(`    ${b.reason}`);
    }
  }

  if (plan.excluded.length > 0) {
    console.log(`\n  Would exclude (no Linear writes):`);
    for (const e of plan.excluded) {
      console.log(`  - ${e.card.identifier} ${e.card.title}`);
      console.log(`    ${e.reason}`);
    }
  }
}

/** Keeps the Mac awake exactly as long as the Runner lives: caffeinate exits with this process. */
function preventSleep() {
  const caffeinate = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true });
  caffeinate.on("error", () => {
    console.error("Warning: caffeinate is not available; the Mac may sleep during the Night Run.");
  });
  caffeinate.unref();
}

async function askToStart(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nStart the Night Run? [y/N] ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const config = loadConfig();
  const dryRun = process.argv.includes("--dry-run");
  // Fail-fast before any Linear traffic: a whole night on the wrong Claude Profile is expensive.
  const profile = resolveClaudeProfile(process.argv, config.claudes, { required: !dryRun });
  const linear = makeLinearPort();
  const clock: ClockPort = {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  // Dead auth aborts, but a startup rate limit pauses the night like any other.
  await withRateLimitRetry(clock, () => linear.checkAuth());
  const resolveClone = makeCloneResolver(config.cloneRoots);

  if (dryRun) {
    const plan = await planNight({ linear, resolveClone });
    printPlan(plan, profile);
    console.log(
      `\n  ${plan.runnable.length} runnable, ${plan.bounced.length} bounced, ${plan.excluded.length} excluded. ${NOTHING_TOUCHED}`,
    );
    return;
  }

  if (!profile) throw new Error("A Night Run requires a Claude Profile"); // unreachable: required above
  preventSleep();
  const nightDate = nightDateStamp(new Date());
  const reportWriter = makeReportWriter(nightDate, profile.name);
  const report = await runNight(
    {
      linear,
      resolveClone,
      executor: makeCardExecutor({
        durationCapMs: config.durationCapMinutes * 60_000,
        model: config.model,
        profile,
        log: (message) => reportWriter.log(message),
      }),
      report: reportWriter,
      clock,
      confirm: async (plan) => {
        printPlan(plan, profile);
        return askToStart();
      },
    },
    { stopTime: config.stopTime, claudeProfile: profile.name },
  );

  if (!report) {
    console.log(`\nAborted. ${NOTHING_TOUCHED}`);
    return;
  }

  console.log("\nNight Run finished.");
  for (const entry of report.ran) {
    console.log(`  ran ${entry.card.identifier} ${entry.card.title}`);
    for (const url of entry.prUrls) console.log(`    ${url}`);
  }
  for (const b of report.bounced) {
    console.log(`  bounced ${b.card.identifier}: ${b.reason}`);
  }
  for (const e of report.excluded) {
    console.log(`  excluded ${e.card.identifier}: ${e.reason}`);
  }
  for (const c of report.notStarted) {
    console.log(`  not started (Stop Time reached): ${c.identifier} ${c.title}`);
  }
  if (report.ran.length === 0) console.log("  No Card ran.");
  console.log("  Morning Report and run log written under nights/.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
