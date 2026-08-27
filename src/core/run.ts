import { planNight } from "./plan.js";
import { withRateLimitRetry } from "./rate-limit.js";
import type { MorningReport, RunDeps, RunOptions } from "./types.js";

/** The next moment the clock reads the Stop Time: today if still ahead, otherwise tomorrow. */
function nextStopTime(start: Date, stopTime: string): Date {
  const [hours, minutes] = stopTime.split(":").map(Number);
  const deadline = new Date(start);
  deadline.setHours(hours!, minutes!, 0, 0);
  if (deadline <= start) deadline.setDate(deadline.getDate() + 1);
  return deadline;
}

/** Executes a Night Run; null means the Plan was declined and nothing ran. */
export async function runNight(deps: RunDeps, options: RunOptions): Promise<MorningReport | null> {
  const retry = <T>(fn: () => Promise<T>) => withRateLimitRetry(deps.clock, fn);

  const plan = await retry(() => planNight(deps));
  if (!(await deps.confirm(plan))) return null;
  const report: MorningReport = { ran: [], bounced: plan.bounced, notStarted: [] };

  for (const bounced of plan.bounced) {
    await retry(() => deps.linear.bounce(bounced.card, bounced.reason));
  }

  const deadline = nextStopTime(deps.clock.now(), options.stopTime);
  for (const runnable of plan.runnable) {
    if (deps.clock.now() >= deadline) {
      report.notStarted.push(runnable.card);
      continue;
    }
    await retry(() => deps.linear.claim(runnable.card));
    const result = await retry(() => deps.executor.execute(runnable));
    if (result.kind === "success") {
      await retry(() => deps.linear.markInReview(runnable.card, result.prUrls));
      report.ran.push({ card: runnable.card, prUrls: result.prUrls });
    } else {
      await retry(() => deps.linear.bounce(runnable.card, result.reason));
      report.bounced.push({ card: runnable.card, reason: result.reason });
    }
  }

  await deps.report.write(report);
  return report;
}
