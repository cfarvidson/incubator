import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMorningReport } from "../core/report.js";
import type { MorningReport, ReportPort } from "../core/types.js";

const NIGHTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nights");

/** The night's date stamp (local time): the evening the run starts, shared by report and log. */
export function nightDateStamp(now: Date): string {
  return now.toLocaleDateString("sv-SE");
}

/**
 * The report/log port: the Morning Report (nights/<date>.md) and the timestamped
 * run log (nights/<date>.log) side by side, named for the evening the run started.
 */
export function makeReportWriter(nightDate: string): ReportPort {
  return {
    async write(report: MorningReport): Promise<void> {
      mkdirSync(NIGHTS_DIR, { recursive: true });
      writeFileSync(join(NIGHTS_DIR, `${nightDate}.md`), renderMorningReport(nightDate, report));
    },
    log(message: string): void {
      mkdirSync(NIGHTS_DIR, { recursive: true });
      appendFileSync(join(NIGHTS_DIR, `${nightDate}.log`), `[${new Date().toLocaleString("sv-SE")}] ${message}\n`);
    },
  };
}
