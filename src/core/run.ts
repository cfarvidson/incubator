import { planNight } from "./plan.js";
import type { NightReport, RunDeps } from "./types.js";

/** Executes a single-Card Night Run: top runnable Card only (CFA-168). */
export async function runNight(deps: RunDeps): Promise<NightReport> {
  const plan = await planNight(deps);
  const report: NightReport = { ran: [], bounced: plan.bounced };

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
