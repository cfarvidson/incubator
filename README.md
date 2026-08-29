# incubator

Overnight execution of prepared work. During the day I prepare Cards in the issue tracker. In the evening I start a Night Run and go home. The Runner works through the queue unattended and leaves PRs, updated issues, and a Morning Report to read over coffee.

Which tracker serves the Cards is picked per run by a **Tracker Profile** (ADR-0003): at work the `work` profile reads the Linear workspace, at home the `home` profile reads GitHub Issues. One run, one profile, one queue.

The Runner itself is a deterministic script, not an agent. Each Card runs in its own headless agent session (on the run's Harness Profile), in its own git worktree of the target repo. See [CONTEXT.md](CONTEXT.md) for the full vocabulary (Card, Brief, Bounce, and so on).

## How a night works

1. `pnpm night` fetches the Night Queue from the active profile's tracker: issues assigned to me, open, label `ready-for-agent` (Linear: the whole work workspace; GitHub: the profile's owner/repo scope).
2. It prints the Plan: which Cards will run in what order, and which get Bounced for an incomplete Brief.
3. One yes/no Abort Prompt. Answering no touches nothing, no tracker writes, no sessions, no worktrees.
4. For each Card: Claim it (Linear: Todo -> In Progress; GitHub: label `in-progress`), run a headless agent session in a fresh worktree, then either mark it done with PR links or Bounce it back with `needs-info` and a comment explaining why.
5. The night ends when the queue is empty or the Stop Time passes. A Morning Report and a timestamped Run Log land in `nights/`.

A Card Session that exceeds the Duration Cap (default 2h) gets its whole process tree killed and the Card is Bounced. Rate limits pause the night with doubling backoff (1 to 15 minutes) rather than aborting it; after the Stop Time a rate-limited Card is Bounced instead of retried. `caffeinate` keeps the Mac awake for exactly as long as the Runner lives.

## Requirements

- Node 26, pnpm
- The harness CLI(s) your Harness Profiles name (`claude`, `codex`, or a custom command) on PATH, authenticated
- For `linear` profiles: `LINEAR_API_KEY` set (personal API key from linear.app > Settings > Security & access > Personal API keys; this repo loads it via `.envrc`)
- For `github` profiles: the `gh` CLI authenticated (`gh auth status`)
- Local clones of the target repos under one of the profile's clone roots

## Commands

```bash
pnpm install

# Preview tonight's Plan. Read-only, writes nothing anywhere.
pnpm night --dry-run

# Preview another profile's Plan (e.g. GitHub Cards at home).
pnpm night --dry-run --profile home

# Start a Night Run. --profile picks the Tracker Profile (defaultProfile when omitted);
# --harness overrides the profile's default Harness Profile, --model the harness's model.
pnpm night --profile home
pnpm night --harness wcodex
pnpm night --harness wclaude --model claude-opus-5

pnpm test        # vitest
pnpm typecheck   # tsc --noEmit
```

In a Claude Code session in this repo there is also:

- `/groom` - the daytime counterpart of a Night Run: goes through the Cards that cannot run tonight (Bounced, `needs-info`, Excluded) and repairs their Briefs interactively until the queue is clean. See `.claude/skills/groom/SKILL.md`.

## Configuration

`incubator.config.json` at the repo root:

| Key | Default | Meaning |
| --- | --- | --- |
| `durationCapMinutes` | `120` | Duration Cap per Card Session. |
| `stopTime` | `"07:00"` | Stop Time (HH:MM, 24h). No new Cards start after this. |
| `harnesses` | required for a real run | Named Harness Profiles, see below. `--harness <name>` or the profile's `harness` picks one. |
| `profiles` | required | Named Tracker Profiles, see below. `pnpm night --profile <name>` picks one. |
| `defaultProfile` | none | The profile used when `--profile` is omitted (a sole profile needs no default). |

Each Tracker Profile has:

| Key | Default | Meaning |
| --- | --- | --- |
| `tracker` | required | `{ "kind": "linear" }`, or `{ "kind": "github", "scope": [...] }` where `scope` lists GitHub owners (`cfarvidson`) and/or repos (`owner/name`) searched for Cards. |
| `cloneRoots` | required | Directories searched for local clones of the repos named in Repo Lines. `~` expands. |
| `harness` | none | Default Harness Profile for this profile; `--harness` overrides. |

Each Harness Profile (an agent CLI Card Sessions run on) has:

| Key | Default | Meaning |
| --- | --- | --- |
| `kind` | `"claude"` | `claude` (print mode, stream-json, the tool policy), `codex` (`codex exec`, worktree sandbox with network), or `custom` (bring your own args). |
| `command` | the kind's name | Executable to spawn (`~` expands) - e.g. a wrapper like `wcodex`. Required for `custom`. Shell aliases/functions do not work; the command must be an executable on PATH. |
| `env` | none | Layered over the Runner's environment (e.g. `CLAUDE_CONFIG_DIR`; `~` expands). |
| `model` | the CLI's default | Model for Card Sessions (e.g. `claude-opus-5`); `--model` overrides per run. |
| `args` | the kind's shape | Argument template: `{prompt}` is replaced by the session prompt, `{model}` by the model (required whenever a model is set - a template without the slot cannot receive one). How `custom` kinds (e.g. grok) are driven; on claude/codex it replaces the built-in shape. |

The claude tool allow/deny policy has no equivalent on other kinds - there (as in depth on claude) the per-worktree pre-push hook is the guard. On a Linear profile, only claude-kind sessions can comment on their Card (the MCP tool); other kinds' session prompt tells them not to comment. GitHub profiles comment via `gh` on every kind.

## Writing a runnable Card

A Card needs a complete Brief or it gets Bounced at plan time:

- A `Repo:` line at the top naming the target repository (on GitHub it may be omitted; the Card then targets the repo it lives in)
- A goal section carrying the scope
- Verification steps

The exact contract lives in `src/core/brief.ts` - that module is the authority. The Bounce comment on the issue says exactly what was missing, so fixing the Brief and re-labeling it queues it for the next night. `/groom` does this systematically for every blocked Card.

## Onboarding

The Runner only serves teams/repos that have what it writes to. A Card without a `needs-info` label in reach is excluded at Plan time with no tracker writes at all, since not even a Bounce could land there. It shows up in the Plan and the Morning Report with the reason.

- **Linear team**: the labels `ready-for-agent` and `needs-info`, and the states `Todo`, `In Progress`, and `In Review`.
- **GitHub repo**: the label `needs-info` (`gh label create needs-info -R owner/name`). The Runner creates `in-progress`/`in-review` itself when first needed; `ready-for-agent` comes into existence when you first queue a Card with it.

Per-tracker Card conventions for agent sessions live in `docs/agents/trackers/`.

## Layout

```
src/core/       Pure logic: planning, the run loop, rate-limit backoff, report rendering
src/adapters/   The messy edges: Linear and GitHub APIs, clone resolution, agent sessions, file writing
src/cli.ts      Entry point wiring the two together
nights/         Morning Reports and Run Logs, one pair per night
.claude/skills/ Repo skills for Claude Code sessions (/groom)
```

Core code talks to the world only through ports (`TrackerPort`, `CardExecutorPort`, `ClockPort`, ...), which is what makes the run loop testable without a real tracker or a real agent session.
