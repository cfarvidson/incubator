# incubator

Overnight execution of prepared work. During the day I prepare Cards in Linear. In the evening I start a Night Run and go home. The Runner works through the queue unattended and leaves PRs, updated Linear issues, and a Morning Report to read over coffee.

The Runner itself is a deterministic script, not an agent. Each Card runs in its own headless Claude session, in its own git worktree of the target repo. See [CONTEXT.md](CONTEXT.md) for the full vocabulary (Card, Brief, Bounce, and so on).

## How a night works

1. `pnpm night` fetches the Night Queue: Linear issues assigned to me, state Todo, label `ready-for-agent`, across the whole work workspace.
2. It prints the Plan: which Cards will run in what order, and which get Bounced for an incomplete Brief.
3. One yes/no Abort Prompt. Answering no touches nothing, no Linear writes, no sessions, no worktrees.
4. For each Card: Claim it (Todo -> In Progress), run a headless Claude session in a fresh worktree, then either mark it done with PR links or Bounce it back to Todo with `needs-info` and a comment explaining why.
5. The night ends when the queue is empty or the Stop Time passes. A Morning Report and a timestamped Run Log land in `nights/`.

A Card Session that exceeds the Duration Cap (default 2h) gets its whole process tree killed and the Card is Bounced. Rate limits pause the night with doubling backoff (1 to 15 minutes) rather than aborting it; after the Stop Time a rate-limited Card is Bounced instead of retried. `caffeinate` keeps the Mac awake for exactly as long as the Runner lives.

## Requirements

- Node 26, pnpm
- The `claude` CLI on PATH, authenticated
- `LINEAR_API_KEY` set (personal API key from linear.app > Settings > Security & access > Personal API keys; this repo loads it via `.envrc`)
- Local clones of the target repos under one of the configured clone roots

## Usage

```bash
pnpm install

# Preview tonight's Plan. Read-only, writes nothing anywhere.
pnpm night --dry-run

# Start a Night Run.
pnpm night
```

## Configuration

`incubator.config.json` at the repo root:

| Key | Default | Meaning |
| --- | --- | --- |
| `cloneRoots` | required | Directories searched for local clones of the repos named in Repo Lines. `~` expands. |
| `durationCapMinutes` | `120` | Duration Cap per Card Session. |
| `stopTime` | `"07:00"` | Stop Time (HH:MM, 24h). No new Cards start after this. |
| `model` | `null` | Model for Card Sessions. `null` uses the Claude CLI's default. |

## Writing a runnable Card

A Card needs a complete Brief or it gets Bounced at plan time:

- A `Repo:` line at the top naming the target repository
- A goal section carrying the scope
- Verification steps

The Bounce comment on the Linear issue says exactly what was missing, so fixing the Brief and re-labeling it queues it for the next night.

## Onboarding a team

The Night Queue spans every team in the Linear workspace, but the Runner only serves teams that have what it writes to:

- The team labels `ready-for-agent` (queues a Card) and `needs-info` (where a Bounce lands)
- The states `Todo`, `In Progress`, and `In Review`

A Card from a team without a `needs-info` label is excluded at Plan time with no Linear writes at all, since not even a Bounce could land there. It shows up in the Plan and the Morning Report with the reason.

## Layout

```
src/core/       Pure logic: planning, the run loop, rate-limit backoff, report rendering
src/adapters/   The messy edges: Linear API, clone resolution, Claude sessions, file writing
src/cli.ts      Entry point wiring the two together
nights/         Morning Reports and Run Logs, one pair per night
```

Core code talks to the world only through ports (`LinearPort`, `CardExecutorPort`, `ClockPort`, ...), which is what makes the run loop testable without a real Linear workspace or a real Claude session.

## Development

```bash
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```
