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

/** The Run Log port: timestamped lines appended to <nightsDir>/<date>.log as the night happens. */
export function makeRunLog(nightDate: string, nightsDir: string = NIGHTS_DIR): RunLogPort {
  return {
    log(message: string): void {
      mkdirSync(nightsDir, { recursive: true });
      appendFileSync(join(nightsDir, `${nightDate}.log`), `[${new Date().toLocaleString("sv-SE")}] ${message}\n`);
    },
  };
}

/** The Morning Report sink: <nightsDir>/<date>.md, rewritten whole after every Card outcome. */
export function makeMorningReportWriter(
  nightDate: string,
  harness: string,
  nightsDir: string = NIGHTS_DIR,
): MorningReportPort {
  return {
    async write(report: MorningReport): Promise<void> {
      mkdirSync(nightsDir, { recursive: true });
      writeFileSync(join(nightsDir, `${nightDate}.md`), renderMorningReport(nightDate, harness, report));
    },
  };
}
