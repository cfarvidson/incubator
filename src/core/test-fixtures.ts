import type { Card } from "./types.js";

export function card(overrides: Partial<Card>): Card {
  return {
    identifier: "CFA-1",
    title: "A card",
    brief: [
      "Repo: cfarvidson/example",
      "",
      "## What to build",
      "Something end-to-end.",
      "",
      "## Acceptance criteria",
      "- [ ] It works",
    ].join("\n"),
    priority: 0,
    url: "https://linear.app/tv4/issue/CFA-1",
    branchName: "cfa-1-a-card",
    teamHasNeedsInfo: true,
    ...overrides,
  };
}
