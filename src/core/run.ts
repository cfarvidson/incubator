import { planNight } from "./plan.js";
import { RateLimitError, withRateLimitRetry } from "./rate-limit.js";
import { formatDuration } from "./report.js";
import type { CardSessionResult, MorningReport, Plan, RunDeps, RunnableCard, RunOptions } from "./types.js";

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
  onWait: (waitMs: number) => void,
): Promise<CardSessionResult> {
  try {
    return await withRateLimitRetry(deps.clock, () => deps.executor.execute(runnable), {
      retryUntil: deadline,
      onWait,
    });
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
  const onWait = (waitMs: number) => deps.report.log(`Rate limited; waiting ${formatDuration(waitMs)} before retrying`);

  // No onWait here: nothing may reach the Run Log before the Abort Prompt is answered.
  const plan = await withRateLimitRetry(deps.clock, () => planNight(deps));
  if (!(await deps.confirm(plan))) return null;
  deps.report.log(
    `Night Run started: ${plan.runnable.length} runnable, ${plan.bounced.length} Bounced at Plan time; Stop Time ${options.stopTime}`,
  );
  const report: MorningReport = { ran: [], bounced: [...plan.bounced], excluded: [...plan.excluded], notStarted: [] };

  try {
    await workTheQueue(deps, options, plan, report, onWait);
  } catch (error) {
    // A crash at 03:00 must leave its cause in the Run Log, not just a truncated night.
    deps.report.log(`Night Run crashed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  return report;
}

async function workTheQueue(
  deps: RunDeps,
  options: RunOptions,
  plan: Plan,
  report: MorningReport,
  onWait: (waitMs: number) => void,
): Promise<void> {
  const retry = <T>(fn: () => Promise<T>) => withRateLimitRetry(deps.clock, fn, { onWait });

  for (const excluded of plan.excluded) {
    deps.report.log(`Excluded ${excluded.card.identifier} (no Linear writes): ${excluded.reason}`);
  }

  for (const bounced of plan.bounced) {
    await retry(() => deps.linear.bounce(bounced.card, bounced.reason));
    deps.report.log(`Bounced ${bounced.card.identifier} at Plan time: ${bounced.reason}`);
  }

  const deadline = nextStopTime(deps.clock.now(), options.stopTime);
  for (const runnable of plan.runnable) {
    const { card } = runnable;
    if (deps.clock.now() >= deadline) {
      report.notStarted.push(card);
      deps.report.log(`Stop Time reached; ${card.identifier} not started`);
      continue;
    }
    await retry(() => deps.linear.claim(card));
    deps.report.log(`Claimed ${card.identifier}; Card Session starting`);
    const startedAt = deps.clock.now();
    const result = await executeWithinStopTime(deps, runnable, deadline, onWait);
    const durationMs = deps.clock.now().getTime() - startedAt.getTime();
    if (result.kind === "success") {
      await retry(() => deps.linear.markInReview(card, result.prUrls));
      report.ran.push({ card, prUrls: result.prUrls, durationMs });
      deps.report.log(`${card.identifier} done in ${formatDuration(durationMs)}: ${result.prUrls.join(" ")}`);
    } else {
      await retry(() => deps.linear.bounce(card, result.reason));
      report.bounced.push({ card, reason: result.reason, durationMs, timedOut: result.kind === "timeout" });
      const how = result.kind === "timeout" ? "timed out" : "failed";
      deps.report.log(`${card.identifier} ${how} after ${formatDuration(durationMs)}; Bounced: ${result.reason}`);
    }
  }

  await deps.report.write(report);
  deps.report.log(
    `Night Run finished: ${report.ran.length} done, ${report.bounced.length} Bounced, ${report.notStarted.length} not started; Morning Report written`,
  );
}
