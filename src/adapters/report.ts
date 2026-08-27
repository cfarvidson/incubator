import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NightReport, ReportPort } from "../core/types.js";

const NIGHTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nights");

export function makeReportWriter(): ReportPort {
  return {
    async write(report: NightReport): Promise<void> {
      const date = new Date().toISOString().slice(0, 10);
      const lines = [`# Night Run ${date}`, ""];
      if (report.ran.length === 0) {
        lines.push("No Cards ran.");
      } else {
        lines.push("## Ran", "");
        for (const entry of report.ran) {
          lines.push(`- ${entry.card.identifier} ${entry.card.title}`);
          for (const url of entry.prUrls) lines.push(`  - ${url}`);
        }
      }
      if (report.bounced.length > 0) {
        lines.push("", "## Bounced", "");
        for (const b of report.bounced) {
          lines.push(`- ${b.card.identifier} ${b.card.title}: ${b.reason}`);
        }
      }
      mkdirSync(NIGHTS_DIR, { recursive: true });
      writeFileSync(join(NIGHTS_DIR, `${date}.md`), lines.join("\n") + "\n");
    },
  };
}
