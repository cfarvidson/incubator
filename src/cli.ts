import { createInterface } from "node:readline/promises";
import { makeCloneResolver } from "./adapters/clone-resolver.js";
import { makeCardExecutor } from "./adapters/executor.js";
import { makeLinearPort } from "./adapters/linear.js";
import { makeReportWriter } from "./adapters/report.js";
import { loadConfig } from "./config.js";
import { planNight } from "./core/plan.js";
import { runNight } from "./core/run.js";
import type { Plan } from "./core/types.js";

const PRIORITY_NAMES: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

function printPlan(plan: Plan) {
  console.log("Tonight's Plan\n");

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
}

async function askToStart(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nStart the Night Run? [y/N] ");
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const config = loadConfig();
  const linear = makeLinearPort();
  const resolveClone = makeCloneResolver(config.cloneRoots);

  if (process.argv.includes("--dry-run")) {
    const plan = await planNight({ linear, resolveClone });
    printPlan(plan);
    console.log(
      `\n  ${plan.runnable.length} runnable, ${plan.bounced.length} bounced. No Linear writes, no sessions, no worktrees.`,
    );
    return;
  }

  const report = await runNight(
    {
      linear,
      resolveClone,
      executor: makeCardExecutor({
        maxCardDurationMs: config.maxCardDurationMinutes * 60_000,
        model: config.model,
      }),
      report: makeReportWriter(),
      clock: {
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      confirm: async (plan) => {
        printPlan(plan);
        return askToStart();
      },
    },
    { stopTime: config.stopTime },
  );

  if (!report) {
    console.log("\nAborted. No Linear writes, no sessions, no worktrees.");
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
  for (const c of report.notStarted) {
    console.log(`  not started (Stop Time reached): ${c.identifier} ${c.title}`);
  }
  if (report.ran.length === 0) console.log("  No Card ran.");
  console.log("  Morning Report written under nights/.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
