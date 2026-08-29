# Issue tracker: Linear (via MCP)

Issues and specs for this repo live in Linear, in the personal team **cfarvidson**. Use the `mcp__linear-work__*` MCP tools for all operations (load them via ToolSearch first).

**This file covers incubator's own development issues only.** The Cards the Runner serves live in the tracker of the active Tracker Profile (`incubator.config.json` -> `profiles`; the run picks one with `--profile`, else `defaultProfile`) - Linear at work, GitHub Issues at home. Skills that touch Cards (`/groom`, the Night Run) must follow the active profile's conventions in [trackers/linear.md](trackers/linear.md) or [trackers/github.md](trackers/github.md), not this file.

## Conventions

- **Create an issue**: `save_issue` with `team: "cfarvidson"`, a title, and a markdown description.
- **Read an issue**: `get_issue` (accepts the CFA-style identifier or ID); `list_comments` for the discussion.
- **List issues**: `list_issues` filtered by `team: "cfarvidson"`, plus state/label filters as needed.
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with the `labels` field (labels are team-scoped; create missing ones with `create_issue_label`).
- **Close**: `save_issue` setting the state to Done (or Canceled for wontfix).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Linear issue in the cfarvidson team.

## When a skill says "fetch the relevant ticket"

Use `get_issue` with the identifier, plus `list_comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Linear issue with **sub-issues** as tickets.

- **Map**: an issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: a sub-issue of the map (`save_issue` with `parent`), labelled `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, assign it to the driving dev.
- **Blocking**: Linear's native "blocked by" relations. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open sub-issues, drop any that are blocked or assigned; first in map order wins.
- **Claim**: assign the issue to yourself (`assignee: "me"`).
- **Resolve**: comment with the answer, mark the issue Done, then append a context pointer to the map's Decisions-so-far.
