import { planNight } from "./plan.js";
import type { MorningReport, RunDeps } from "./types.js";

/** Executes a single-Card Night Run: top runnable Card only (CFA-168). */
export async function runNight(deps: RunDeps): Promise<MorningReport> {
  const plan = await planNight(deps);
  const report: MorningReport = { ran: [], bounced: plan.bounced };

  const top = plan.runnable[0];
  if (top) {
    await deps.linear.claim(top.card);
    const outcome = await deps.executor.execute(top);
    await deps.linear.markInReview(top.card, outcome.prUrls);
    report.ran.push({ card: top.card, prUrls: outcome.prUrls });
  }

  await deps.report.write(report);
  return report;
}
