import type { BouncedCard, MorningReport } from "./types.js";

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
export function renderMorningReport(date: string, report: MorningReport): string {
  const lines = [`# Night Run ${date}`, ""];
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
  if (report.notStarted.length > 0) {
    lines.push("", "## Not started (Stop Time reached)", "");
    for (const c of report.notStarted) {
      lines.push(`- ${c.identifier} ${c.title}`);
    }
  }
  return lines.join("\n") + "\n";
}
