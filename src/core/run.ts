import { planNight } from "./plan.js";
import { RateLimitError, withRateLimitRetry } from "./rate-limit.js";
import type { CardSessionResult, MorningReport, RunDeps, RunnableCard, RunOptions } from "./types.js";

/** The next moment the clock reads the Stop Time: today if still ahead, otherwise tomorrow. */
function nextStopTime(start: Date, stopTime: string): Date {
  const [hours, minutes] = stopTime.split(":").map(Number);
  const deadline = new Date(start);
  deadline.setHours(hours!, minutes!, 0, 0);
  if (deadline <= start) deadline.setDate(deadline.getDate() + 1);
  return deadline;
}

/**
 * A rate-limited session retries only until the Stop Time; past it, the Card is
 * Bounced instead. Linear calls, by contrast, retry without a deadline - those
 * limits are short-lived and a paused write must still land.
 */
async function executeWithinStopTime(
  deps: RunDeps,
  runnable: RunnableCard,
  deadline: Date,
): Promise<CardSessionResult> {
  try {
    return await withRateLimitRetry(deps.clock, () => deps.executor.execute(runnable), deadline);
  } catch (error) {
    if (!(error instanceof RateLimitError)) throw error;
    return {
      kind: "failure",
      reason: `Card Session for ${runnable.card.identifier} was rate limited and the Stop Time passed before it could be retried`,
    };
  }
}

/** Executes a Night Run; null means the Plan was declined and nothing ran. */
export async function runNight(deps: RunDeps, options: RunOptions): Promise<MorningReport | null> {
  const retry = <T>(fn: () => Promise<T>) => withRateLimitRetry(deps.clock, fn);

  const plan = await retry(() => planNight(deps));
  if (!(await deps.confirm(plan))) return null;
  const report: MorningReport = { ran: [], bounced: [...plan.bounced], notStarted: [] };

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
    const result = await executeWithinStopTime(deps, runnable, deadline);
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
