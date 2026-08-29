# Cards on Linear (Tracker Profiles with `"kind": "linear"`)

How Cards look when the active Tracker Profile points at Linear. Use the `mcp__linear-work__*` MCP tools (load them via ToolSearch first).

- **A Card**: a Linear issue assigned to me, anywhere in the workspace. The Brief is the issue description.
- **Night Queue**: state Todo + label `ready-for-agent`. `list_issues` with those filters.
- **Claimed**: state In Progress (the Runner moves it), with a `Night Run: Claimed.` comment.
- **Done for the night**: state In Review, comment `Night Run result: done.` with PR links.
- **Bounced**: back to Todo, label swapped `ready-for-agent` -> `needs-info`, comment `Night Run result: Bounced.` with the reason.
- **Re-queue after grooming**: `save_issue` with the repaired description, labels swapped `needs-info` -> `ready-for-agent`, state Todo.
- **Onboarded team**: has the labels `ready-for-agent` and `needs-info`, and the states Todo, In Progress, In Review.
- **Priority**: Linear's own field (urgent runs first).
