import { makeCloneResolver } from "./adapters/clone-resolver.js";
import { makeLinearPort } from "./adapters/linear.js";
import { loadConfig } from "./config.js";
import { planNight } from "./core/plan.js";

const PRIORITY_NAMES: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

async function main() {
  const config = loadConfig();
  const plan = await planNight({
    linear: makeLinearPort(),
    resolveClone: makeCloneResolver(config.cloneRoots),
  });

  console.log("Tonight's Plan (dry-run - nothing has been touched)\n");

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

  console.log(
    `\n  ${plan.runnable.length} runnable, ${plan.bounced.length} bounced. No Linear writes, no sessions, no worktrees.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
