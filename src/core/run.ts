import { planNight } from "./plan.js";
import { BACKOFF_BASE_MS, BACKOFF_CAP_MS, withRateLimitRetry } from "./rate-limit.js";
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
 * A rate-limited session (a `rate-limited` result, never an exception) retries
 * with doubling Backoff, but only until the Stop Time; past it, the Card is
 * Bounced instead. Linear calls, by contrast, retry without a deadline - those
 * limits are short-lived and a paused write must still land.
 */
async function executeWithinStopTime(
  deps: RunDeps,
  runnable: RunnableCard,
  deadline: Date,
  onWait: (waitMs: number) => void,
): Promise<Exclude<CardSessionResult, { kind: "rate-limited" }>> {
  let wait = BACKOFF_BASE_MS;
  for (;;) {
    let result: CardSessionResult;
    try {
      result = await deps.executor.execute(runnable);
    } catch (error) {
      // Ctrl+C outside the session itself kills the executor's git/gh child
      // and surfaces here as an error; the interruption outranks its prose.
      if (deps.interruption.interrupted()) return { kind: "interrupted" };
      // Infrastructure trouble (a leftover worktree, a network blip) costs
      // this one Card, not the rest of the night: it Bounces like any failure.
      return { kind: "failure", reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.kind !== "rate-limited") return result;
    if (deps.clock.now() >= deadline) {
      return {
        kind: "failure",
        reason: `Card Session for ${runnable.card.identifier} was rate limited and the Stop Time passed before it could be retried`,
      };
    }
    onWait(wait);
    // A Backoff wait can be 15 minutes; Ctrl+C cuts it short instead of sitting it out.
    await Promise.race([deps.clock.sleep(wait), deps.interruption.whenInterrupted()]);
    if (deps.interruption.interrupted()) return { kind: "interrupted" };
    wait = Math.min(wait * 2, BACKOFF_CAP_MS);
  }
}

/** Executes a Night Run; null means the Plan was declined and nothing ran. */
export async function runNight(deps: RunDeps, options: RunOptions): Promise<MorningReport | null> {
  const onWait = (waitMs: number) => deps.runLog.log(`Rate limited; waiting ${formatDuration(waitMs)} before retrying`);

  // No onWait here: nothing may reach the Run Log before the Abort Prompt is answered.
  const plan = await withRateLimitRetry(deps.clock, () => planNight(deps));
  // Ctrl+C while planning: nothing is written yet, so the night simply never starts.
  if (deps.interruption.interrupted()) return null;
  if (!(await deps.confirm(plan))) return null;
  const profileNote = options.claudeProfile ? ` (Claude Profile ${options.claudeProfile})` : "";
  deps.runLog.log(
    `Night Run started${profileNote}: ${plan.runnable.length} runnable, ${plan.bounced.length} Bounced at Plan time; Stop Time ${options.stopTime}`,
  );
  const report: MorningReport = { ran: [], bounced: [...plan.bounced], excluded: [...plan.excluded], notStarted: [] };

  try {
    await workTheQueue(deps, options, plan, report, onWait);
  } catch (error) {
    // A crash at 03:00 must leave its cause in the Run Log, not just a truncated night.
    report.crashReason = error instanceof Error ? error.message : String(error);
    deps.runLog.log(`Night Run crashed: ${report.crashReason}`);
    throw error;
  } finally {
    // The Morning Report always lands, crash or not (the 2026-08-28 night was lost to this).
    try {
      await deps.morningReport.write(report);
    } catch (writeError) {
      // Never mask the night's own error with a failed report write; the Run Log gets it instead.
      deps.runLog.log(
        `Morning Report could not be written: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
      );
    }
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
    deps.runLog.log(`Excluded ${excluded.card.identifier} (no Linear writes): ${excluded.reason}`);
  }

  for (const bounced of plan.bounced) {
    await retry(() => deps.linear.bounce(bounced.card, bounced.reason));
    deps.runLog.log(`Bounced ${bounced.card.identifier} at Plan time: ${bounced.reason}`);
  }
  // First incremental write: even a run dying on its first Card Session leaves the Plan-time outcomes.
  await deps.morningReport.write(report);

  const deadline = nextStopTime(deps.clock.now(), options.stopTime);
  for (const [index, runnable] of plan.runnable.entries()) {
    const { card } = runnable;
    if (deps.interruption.interrupted()) {
      // Ctrl+C between Cards: nothing here was Claimed, so no Bounce - the
      // rest of the queue stays in Linear untouched and is reported as not started.
      windDownInterrupted(deps, plan, report, index);
      await deps.morningReport.write(report);
      break;
    }
    if (deps.clock.now() >= deadline) {
      report.notStarted.push(card);
      deps.runLog.log(`Stop Time reached; ${card.identifier} not started`);
      await deps.morningReport.write(report);
      continue;
    }
    await retry(() => deps.linear.claim(card));
    deps.runLog.log(`Claimed ${card.identifier}; Card Session starting`);
    const startedAt = deps.clock.now();
    const result = await executeWithinStopTime(deps, runnable, deadline, onWait);
    const durationMs = deps.clock.now().getTime() - startedAt.getTime();
    if (result.kind === "interrupted") {
      // Ctrl+C: Bounce the in-flight Card and land the report before cli.ts exits 130.
      const reason = "interrupted by user during Night Run";
      await retry(() => deps.linear.bounce(card, reason));
      report.bounced.push({ card, reason, durationMs, timedOut: false });
      deps.runLog.log(`${card.identifier} interrupted after ${formatDuration(durationMs)}; Bounced: ${reason}`);
      windDownInterrupted(deps, plan, report, index + 1);
      await deps.morningReport.write(report);
      break;
    }
    if (result.kind === "success") {
      await retry(() => deps.linear.markInReview(card, result.prUrls));
      report.ran.push({ card, prUrls: result.prUrls, durationMs });
      deps.runLog.log(`${card.identifier} done in ${formatDuration(durationMs)}: ${result.prUrls.join(" ")}`);
    } else {
      await retry(() => deps.linear.bounce(card, result.reason));
      report.bounced.push({ card, reason: result.reason, durationMs, timedOut: result.kind === "timeout" });
      const how = result.kind === "timeout" ? "timed out" : "failed";
      deps.runLog.log(`${card.identifier} ${how} after ${formatDuration(durationMs)}; Bounced: ${result.reason}`);
    }
    // Incremental write after every Card outcome: a hard kill loses at most the Card in flight.
    await deps.morningReport.write(report);
  }

  const ending = report.interrupted ? "Night Run interrupted by user" : "Night Run finished";
  deps.runLog.log(
    `${ending}: ${report.ran.length} done, ${report.bounced.length} Bounced, ${report.notStarted.length} not started; Morning Report written`,
  );
}

/** Marks the night interrupted; the Cards that never started stay in the Night Queue and are reported as such. */
function windDownInterrupted(deps: RunDeps, plan: Plan, report: MorningReport, fromIndex: number): void {
  report.interrupted = true;
  const remaining = plan.runnable.slice(fromIndex).map((r) => r.card);
  if (remaining.length === 0) return;
  report.notStarted.push(...remaining);
  deps.runLog.log(`Interrupted by user; ${remaining.map((c) => c.identifier).join(", ")} not started`);
}
