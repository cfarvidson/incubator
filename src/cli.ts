import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { makeCloneResolver } from "./adapters/clone-resolver.js";
import { makeCardExecutor } from "./adapters/executor.js";
import { makeLinearPort } from "./adapters/linear.js";
import { makeMorningReportWriter, makeRunLog, nightDateStamp } from "./adapters/report.js";
import { resolveClaudeProfile } from "./claude-profile.js";
import { loadConfig } from "./config.js";
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
    console.log(renderPlan(plan, profile?.name ?? null).join("\n"));
    console.log(renderDryRunSummary(plan).join("\n"));
    return;
  }

  if (!profile) throw new Error("A Night Run requires a Claude Profile"); // unreachable: required above
  preventSleep();
  const nightDate = nightDateStamp(new Date());
  const runLog = makeRunLog(nightDate);
  const report = await runNight(
    {
      linear,
      resolveClone,
      executor: makeCardExecutor({
        durationCapMs: config.durationCapMinutes * 60_000,
        model: config.model,
        profile,
        log: (message) => runLog.log(message),
      }),
      runLog,
      morningReport: makeMorningReportWriter(nightDate, profile.name),
      clock,
      confirm: async (plan) => {
        console.log(renderPlan(plan, profile.name).join("\n"));
        return askToStart();
      },
    },
    { stopTime: config.stopTime, claudeProfile: profile.name },
  );

  if (!report) {
    console.log(renderAborted().join("\n"));
    return;
  }

  console.log(renderFinishSummary(report).join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
