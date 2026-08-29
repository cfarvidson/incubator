import { PRIORITY_NAMES } from "./plan.js";
import type { BouncedCard, MorningReport, Plan } from "./types.js";

const NOTHING_TOUCHED = "No tracker writes, no sessions, no worktrees.";

/** Renders tonight's Plan for the terminal: run order with priorities, Bounces, and exclusions. */
export function renderPlan(plan: Plan, harnessName: string | null): string[] {
  const lines = [harnessName ? `Tonight's Plan - Harness: ${harnessName}` : "Tonight's Plan", ""];

  if (plan.runnable.length === 0) {
    lines.push("  Nothing runnable in the Night Queue.");
  } else {
    lines.push("  Would run, in order:");
    plan.runnable.forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.card.identifier} [${PRIORITY_NAMES[r.card.priority] ?? "?"}] ${r.card.title}`);
      lines.push(`     ${r.repo} -> ${r.clonePath}`);
    });
  }

  if (plan.bounced.length > 0) {
    lines.push("", "  Would bounce:");
    for (const b of plan.bounced) {
      lines.push(`  - ${b.card.identifier} ${b.card.title}`, `    ${b.reason}`);
    }
  }

  if (plan.excluded.length > 0) {
    lines.push("", "  Would exclude (no tracker writes):");
    for (const e of plan.excluded) {
      lines.push(`  - ${e.card.identifier} ${e.card.title}`, `    ${e.reason}`);
    }
  }

  return lines;
}

/** The dry-run closing line: Plan counts plus the promise that nothing was touched. */
export function renderDryRunSummary(plan: Plan): string[] {
  return [
    "",
    `  ${plan.runnable.length} runnable, ${plan.bounced.length} bounced, ${plan.excluded.length} excluded. ${NOTHING_TOUCHED}`,
  ];
}

/** The terminal message when the user declines to start the Night Run. */
export function renderAborted(): string[] {
  return ["", `Aborted. ${NOTHING_TOUCHED}`];
}

/** The terminal summary after a finished Night Run: every Card outcome, one line each. */
export function renderFinishSummary(report: MorningReport): string[] {
  const lines = ["", "Night Run finished."];
  for (const entry of report.ran) {
    lines.push(`  ran ${entry.card.identifier} ${entry.card.title}`);
    for (const url of entry.prUrls) lines.push(`    ${url}`);
  }
  for (const b of report.bounced) {
    lines.push(`  bounced ${b.card.identifier}: ${b.reason}`);
  }
  for (const e of report.excluded) {
    lines.push(`  excluded ${e.card.identifier}: ${e.reason}`);
  }
  for (const c of report.notStarted) {
    lines.push(`  not started (Stop Time reached): ${c.identifier} ${c.title}`);
  }
  if (report.ran.length === 0) lines.push("  No Card ran.");
  lines.push("  Morning Report and run log written under nights/.");
  return lines;
}

/** Morning-friendly wall-clock duration: minutes below an hour, "2h 05m" above. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
}

function bounceOutcome(b: BouncedCard): string {
  if (b.durationMs === undefined) return "Bounced at Plan time";
  const after = formatDuration(b.durationMs);
  return b.timedOut ? `timed out after ${after}` : `Bounced after ${after}`;
}

/** Renders the Morning Report markdown: every Card of the night with outcome, PR links, and duration. */
export function renderMorningReport(date: string, harnessName: string, report: MorningReport): string {
  const lines = [`# Night Run ${date}`, "", `Harness: ${harnessName}`, ""];
  if (report.crashReason) {
    lines.push(`**Night Run crashed:** ${report.crashReason}`, "");
  }
  if (report.ran.length === 0) {
    lines.push("No Cards ran.");
  } else {
    lines.push("## Ran", "");
    for (const entry of report.ran) {
      lines.push(`- ${entry.card.identifier} ${entry.card.title} - done in ${formatDuration(entry.durationMs)}`);
      for (const url of entry.prUrls) lines.push(`  - ${url}`);
    }
  }
  if (report.bounced.length > 0) {
    lines.push("", "## Bounced", "");
    for (const b of report.bounced) {
      lines.push(`- ${b.card.identifier} ${b.card.title} - ${bounceOutcome(b)}: ${b.reason}`);
    }
  }
  if (report.excluded.length > 0) {
    lines.push("", "## Excluded (not onboarded)", "");
    for (const e of report.excluded) {
      lines.push(`- ${e.card.identifier} ${e.card.title} - ${e.reason}`);
    }
  }
  if (report.notStarted.length > 0) {
    lines.push("", "## Not started (Stop Time reached)", "");
    for (const c of report.notStarted) {
      lines.push(`- ${c.identifier} ${c.title}`);
    }
  }
  return lines.join("\n") + "\n";
}
