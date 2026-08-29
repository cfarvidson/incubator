import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { card } from "../core/test-fixtures.js";
import { makeMorningReportWriter, makeRunLog } from "./report.js";

let nightsDir: string;

beforeEach(() => {
  nightsDir = mkdtempSync(join(tmpdir(), "nights-"));
});

afterEach(() => {
  rmSync(nightsDir, { recursive: true, force: true });
});

describe("makeRunLog", () => {
  it("appends timestamped lines to <nightsDir>/<date>.log", () => {
    const runLog = makeRunLog("2026-08-29", nightsDir);
    runLog.log("Night Run started");
    runLog.log("Claimed CFA-1");
    const lines = readFileSync(join(nightsDir, "2026-08-29.log"), "utf8").split("\n");
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Night Run started$/);
    expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Claimed CFA-1$/);
    expect(lines[2]).toBe("");
  });
});

describe("makeMorningReportWriter", () => {
  it("writes the rendered report to <nightsDir>/<date>.md", async () => {
    const writer = makeMorningReportWriter("2026-08-29", "wclaude", nightsDir);
    await writer.write({
      ran: [{ card: card({ identifier: "CFA-1", title: "A card" }), prUrls: ["https://github.com/x/y/pull/1"], durationMs: 65 * 60_000 }],
      bounced: [{ card: card({ identifier: "CFA-2", title: "Another card" }), reason: "no Repo Line" }],
      excluded: [],
      notStarted: [],
    });
    expect(readFileSync(join(nightsDir, "2026-08-29.md"), "utf8")).toBe(
      [
        "# Night Run 2026-08-29",
        "",
        "Harness: wclaude",
        "",
        "## Ran",
        "",
        "- CFA-1 A card - done in 1h 05m",
        "  - https://github.com/x/y/pull/1",
        "",
        "## Bounced",
        "",
        "- CFA-2 Another card - Bounced at Plan time: no Repo Line",
        "",
      ].join("\n"),
    );
  });

  it("rewrites the whole file on every write", async () => {
    const writer = makeMorningReportWriter("2026-08-29", "wclaude", nightsDir);
    await writer.write({ ran: [], bounced: [], excluded: [], notStarted: [], crashReason: "boom" });
    await writer.write({ ran: [], bounced: [], excluded: [], notStarted: [] });
    const content = readFileSync(join(nightsDir, "2026-08-29.md"), "utf8");
    expect(content).toBe("# Night Run 2026-08-29\n\nHarness: wclaude\n\nNo Cards ran.\n");
  });
});
