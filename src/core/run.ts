import { planNight } from "./plan.js";
import type { MorningReport, RunDeps } from "./types.js";

/** Executes a single-Card Night Run: top runnable Card only (CFA-168). */
export async function runNight(deps: RunDeps): Promise<MorningReport> {
  const plan = await planNight(deps);
  const report: MorningReport = { ran: [], bounced: plan.bounced };

  for (const bounced of plan.bounced) {
    await deps.linear.bounce(bounced.card, bounced.reason);
  }

  const top = plan.runnable[0];
  if (top) {
    await deps.linear.claim(top.card);
    const result = await deps.executor.execute(top);
    if (result.kind === "success") {
      await deps.linear.markInReview(top.card, result.prUrls);
      report.ran.push({ card: top.card, prUrls: result.prUrls });
    } else {
      await deps.linear.bounce(top.card, result.reason);
      report.bounced.push({ card: top.card, reason: result.reason });
    }
  }

  await deps.report.write(report);
  return report;
}
