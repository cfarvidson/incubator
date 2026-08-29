import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { makeCloneResolver } from "./adapters/clone-resolver.js";
import { makeCardExecutor } from "./adapters/executor.js";
import { makeInterruptionWatcher } from "./adapters/interruption.js";
import { makeMorningReportWriter, makeRunLog, nightDateStamp } from "./adapters/report.js";
import { makeTracker } from "./adapters/tracker.js";
import { loadConfig, resolveTrackerProfile } from "./config.js";
import { resolveHarnessProfile } from "./harness.js";
import { durationCapFromMinutes } from "./core/duration-cap.js";
import { planNight } from "./core/plan.js";
import { withRateLimitRetry } from "./core/rate-limit.js";
import { renderAborted, renderDryRunSummary, renderFinishSummary, renderPlan } from "./core/report.js";
import { runNight } from "./core/run.js";
import type { ClockPort } from "./core/types.js";

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
  const profile = resolveTrackerProfile(process.argv, config);
  // Fail-fast before any tracker traffic: a whole night on the wrong Harness Profile is expensive.
  const harness = resolveHarnessProfile(process.argv, config.harnesses, {
    required: !dryRun,
    defaultName: profile.harness,
  });
  const { tracker, sessionHints } = makeTracker(profile.tracker);
  const clock: ClockPort = {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  // Dead auth aborts, but a startup rate limit pauses the night like any other.
  await withRateLimitRetry(clock, () => tracker.checkAuth());
  const resolveClone = makeCloneResolver(profile.cloneRoots);

  if (dryRun) {
    const plan = await planNight({ tracker, resolveClone });
    console.log(renderPlan(plan, harness?.name ?? null).join("\n"));
    console.log(renderDryRunSummary(plan).join("\n"));
    return;
  }

  if (!harness) throw new Error("A Night Run requires a Harness Profile"); // unreachable: required above
  preventSleep();
  // First Ctrl+C winds the night down at the next safe point; a second is the
  // user insisting, and exits without the Bounce and Morning Report guarantees.
  let sigints = 0;
  process.on("SIGINT", () => {
    sigints += 1;
    if (sigints === 1) {
      console.error("\nCtrl+C: winding down the Night Run; press Ctrl+C again to exit immediately.");
    } else {
      process.exit(130);
    }
  });
  const interruption = makeInterruptionWatcher();
  const nightDate = nightDateStamp(new Date());
  const runLog = makeRunLog(nightDate);
  const report = await runNight(
    {
      tracker,
      resolveClone,
      executor: makeCardExecutor({
        durationCap: durationCapFromMinutes(config.durationCapMinutes),
        profile: harness,
        sessionHints,
        log: (message) => runLog.log(message),
      }),
      runLog,
      morningReport: makeMorningReportWriter(nightDate, harness.name),
      clock,
      interruption,
      confirm: async (plan) => {
        console.log(renderPlan(plan, harness.name).join("\n"));
        return askToStart();
      },
    },
    { stopTime: config.stopTime, harness: harness.name },
  );

  if (!report) {
    console.log(renderAborted().join("\n"));
    if (interruption.interrupted()) process.exit(130);
    return;
  }

  console.log(renderFinishSummary(report).join("\n"));
  // Ctrl+C ends the night with the conventional SIGINT exit code, but only
  // here, after the Bounce and the Morning Report have landed.
  if (report.interrupted) process.exit(130);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
