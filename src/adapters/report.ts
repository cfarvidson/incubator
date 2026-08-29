import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMorningReport } from "../core/report.js";
import type { MorningReport, MorningReportPort, RunLogPort } from "../core/types.js";

const NIGHTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nights");

/** The night's date stamp (local time): the evening the run starts, shared by report and log. */
export function nightDateStamp(now: Date): string {
  return now.toLocaleDateString("sv-SE");
}

/** The Run Log port: timestamped lines appended to nights/<date>.log as the night happens. */
export function makeRunLog(nightDate: string): RunLogPort {
  return {
    log(message: string): void {
      mkdirSync(NIGHTS_DIR, { recursive: true });
      appendFileSync(join(NIGHTS_DIR, `${nightDate}.log`), `[${new Date().toLocaleString("sv-SE")}] ${message}\n`);
    },
  };
}

/** The Morning Report sink: nights/<date>.md, rewritten whole after every Card outcome. */
export function makeMorningReportWriter(nightDate: string, claudeProfile: string): MorningReportPort {
  return {
    async write(report: MorningReport): Promise<void> {
      mkdirSync(NIGHTS_DIR, { recursive: true });
      writeFileSync(join(NIGHTS_DIR, `${nightDate}.md`), renderMorningReport(nightDate, claudeProfile, report));
    },
  };
}
