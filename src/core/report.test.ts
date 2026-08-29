import { describe, expect, it } from "vitest";
import { bounceReasons } from "./brief.js";
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
    const markdown = renderMorningReport("2026-01-06", "wclaude", {
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
          reason: bounceReasons.noRepoLine,
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
      excluded: [
        {
          card: card({ identifier: "CFA-96", title: "From an IRIS-like team" }),
          reason: "Team not onboarded: it has no `needs-info` label, so a Bounce cannot land",
        },
      ],
      notStarted: [card({ identifier: "CFA-71", title: "Left for tomorrow" })],
    });

    expect(markdown).toBe(
      [
        "# Night Run 2026-01-06",
        "",
        "Claude Profile: wclaude",
        "",
        "## Ran",
        "",
        "- CFA-61 Ship the thing - done in 1h 12m",
        "  - https://github.com/cfarvidson/example/pull/1",
        "",
        "## Bounced",
        "",
        `- CFA-30 Underspecified - Bounced at Plan time: ${bounceReasons.noRepoLine}`,
        "- CFA-40 Broke midway - Bounced after 12m: Card Session for CFA-40 exited with status 1",
        "- CFA-41 Got stuck - timed out after 2h 00m: Card Session for CFA-41 hit the 2h Duration Cap and was stopped",
        "",
        "## Excluded (team not onboarded)",
        "",
        "- CFA-96 From an IRIS-like team - Team not onboarded: it has no `needs-info` label, so a Bounce cannot land",
        "",
        "## Not started (Stop Time reached)",
        "",
        "- CFA-71 Left for tomorrow",
        "",
      ].join("\n"),
    );
  });

  it("leads with the crash reason when the night crashed, keeping the outcomes so far", () => {
    const markdown = renderMorningReport("2026-01-06", "wclaude", {
      ran: [],
      bounced: [],
      excluded: [],
      notStarted: [],
      crashReason: "Linear API error: boom",
    });
    expect(markdown).toBe(
      [
        "# Night Run 2026-01-06",
        "",
        "Claude Profile: wclaude",
        "",
        "**Night Run crashed:** Linear API error: boom",
        "",
        "No Cards ran.",
        "",
      ].join("\n"),
    );
  });

  it("says so when no Cards ran", () => {
    const markdown = renderMorningReport("2026-01-06", "dclaude", { ran: [], bounced: [], excluded: [], notStarted: [] });
    expect(markdown).toBe(
      ["# Night Run 2026-01-06", "", "Claude Profile: dclaude", "", "No Cards ran.", ""].join("\n"),
    );
  });
});
