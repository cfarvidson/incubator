import { describe, expect, it } from "vitest";
import { formatDuration, renderMorningReport } from "./report.js";
import { card } from "./test-fixtures.js";

describe("formatDuration", () => {
  it("renders minutes below an hour", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
  });

  it("renders hours with zero-padded minutes", () => {
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe("2h 05m");
  });

  it("rounds sub-minute durations down to 0m", () => {
    expect(formatDuration(20_000)).toBe("0m");
  });
});

describe("renderMorningReport", () => {
  it("lists every Card with outcome, PR links, and duration", () => {
    const markdown = renderMorningReport("2026-01-06", {
      ran: [
        {
          card: card({ identifier: "CFA-61", title: "Ship the thing" }),
          prUrls: ["https://github.com/cfarvidson/example/pull/1"],
          durationMs: 72 * 60_000,
        },
      ],
      bounced: [
        {
          card: card({ identifier: "CFA-30", title: "Underspecified" }),
          reason: "Brief has no Repo Line (`Repo: owner/name`)",
        },
        {
          card: card({ identifier: "CFA-40", title: "Broke midway" }),
          reason: "Card Session for CFA-40 exited with status 1",
          durationMs: 12 * 60_000,
          timedOut: false,
        },
        {
          card: card({ identifier: "CFA-41", title: "Got stuck" }),
          reason: "Card Session for CFA-41 hit the 2h Duration Cap and was stopped",
          durationMs: 120 * 60_000,
          timedOut: true,
        },
      ],
      notStarted: [card({ identifier: "CFA-71", title: "Left for tomorrow" })],
    });

    expect(markdown).toBe(
      [
        "# Night Run 2026-01-06",
        "",
        "## Ran",
        "",
        "- CFA-61 Ship the thing - done in 1h 12m",
        "  - https://github.com/cfarvidson/example/pull/1",
        "",
        "## Bounced",
        "",
        "- CFA-30 Underspecified - Bounced at Plan time: Brief has no Repo Line (`Repo: owner/name`)",
        "- CFA-40 Broke midway - Bounced after 12m: Card Session for CFA-40 exited with status 1",
        "- CFA-41 Got stuck - timed out after 2h 00m: Card Session for CFA-41 hit the 2h Duration Cap and was stopped",
        "",
        "## Not started (Stop Time reached)",
        "",
        "- CFA-71 Left for tomorrow",
        "",
      ].join("\n"),
    );
  });

  it("says so when no Cards ran", () => {
    const markdown = renderMorningReport("2026-01-06", { ran: [], bounced: [], notStarted: [] });
    expect(markdown).toBe(["# Night Run 2026-01-06", "", "No Cards ran.", ""].join("\n"));
  });
});
