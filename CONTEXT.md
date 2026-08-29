# Incubator

Overnight execution of prepared work. Cards are prepared in the issue tracker during the day; a manually started night run builds them unattended and leaves PRs and a report for the morning.

## Language

**Card**:
An issue assigned to me, in the active Tracker Profile's tracker, that describes one night-sized unit of work.
_Avoid_: ticket, task

**Tracker Profile**:
A named choice of where Cards live and how this machine runs them: a tracker (Linear, or GitHub Issues with an owner/repo scope), clone roots, and a default Claude Profile. Defined in `incubator.config.json` under `profiles`; a run works under exactly one (`--profile <name>`, else `defaultProfile`). Work reads Linear, home reads GitHub.
_Avoid_: environment, mode

**Brief**:
The fully specified body of a Card: a goal section (which carries the scope), verification steps, and a Repo Line. A Card without a complete Brief is Bounced, not run.
_Avoid_: spec, description

**Repo Line**:
The `Repo:` row at the top of a Brief naming the target repository the Card is built in. On GitHub it may be omitted; the Card then targets the repo it lives in.

**Night Queue**:
The Cards eligible to run tonight: open, assigned to me, label `ready-for-agent`, not yet Claimed - anywhere the active Tracker Profile reaches (the Linear work workspace, or the GitHub scope).
_Avoid_: backlog

**Night Run**:
One manually started, unattended execution of the Night Queue, from when I leave work until the queue is empty or the Stop Time is reached.

**Runner**:
The deterministic script that orchestrates a Night Run: shows the Plan, claims Cards, starts Card Sessions, updates the tracker, writes the Morning Report. The Runner itself is not an agent.
_Avoid_: orchestrator, daemon

**Card Session**:
The headless Claude session that executes a single Card in its own git worktree of the target repository.

**Claude Profile**:
A named way to run the Claude CLI - environment variables (e.g. `CLAUDE_CONFIG_DIR`) and optionally a command - selecting which credentials Card Sessions use. Defined in `incubator.config.json` under `claudes`; a real run picks exactly one (`--claude <name>`, else the Tracker Profile's `claude` default) and refuses to start without one.
_Avoid_: alias, account

**Groom**:
The daytime pass over Cards that cannot run tonight - Bounced, `needs-info`, or Excluded - repairing their Briefs so they enter the Night Queue. Done interactively via the `/groom` skill; the Runner never grooms.
_Avoid_: triage, refine

**Parked**:
A Card deliberately left out of grooming: not runnable tonight by the user's choice, untouched, with a noted reason.

**Claim**:
Marking a Card in progress when the Runner picks it up (Linear: state Todo -> In Progress; GitHub: label `in-progress`), so no other run takes it. The Claim leaves a marker comment so a dead run's Cards can be recognized as Stranded.

**Stranded**:
A Card Claimed by a Night Run that never finished: still marked in progress, with the Claim as its latest Night Run comment. The next run's Plan Bounces Stranded Cards back for grooming.

**Bounce**:
Returning a Card to the groomable state - `ready-for-agent` swapped for `needs-info`, with an explanatory comment - instead of (or after failing at) running it.

**Excluded**:
A Card left out of a Night Run at Plan time because its team/repo is not onboarded (no `needs-info` label in reach, so not even a Bounce could land). Excluded Cards get no tracker writes at all; they are listed in the Plan and the Morning Report with the reason.

**Onboarded team/repo**:
A place the Runner can serve. Linear team: the labels `ready-for-agent` and `needs-info`, and the states Todo, In Progress, and In Review. GitHub repo: a `needs-info` label; the Runner creates the other labels it writes.

**Plan**:
The terminal listing shown when a Night Run starts: which Cards will run, in what order, and which were Bounced or Excluded.

**Morning Report**:
The markdown file written in this repo at the end of a Night Run: per Card, the outcome (done / Bounced / timed out / Excluded), duration, and PR links.

**Run Log**:
The timestamped file written next to the Morning Report (nights/YYYY-MM-DD.log) recording the night's events as they happen, so 03:00 can be reconstructed in the morning.

**Duration Cap**:
The maximum wall-clock time one Card Session may run (default 2h). A Card hitting it has its session stopped and is Bounced.

**Stop Time**:
The clock time at which a Night Run stops starting new Cards.

**Abort Prompt**:
The single yes/no gate shown after the Plan; declining runs nothing - no tracker writes, no sessions, no worktrees.

**Backoff**:
The wait-and-retry response to rate limiting or exhausted quota (1 to 15 minutes, doubling). Rate limits pause the night, they never abort it; once the Stop Time passes, a rate-limited Card is Bounced instead of retried.

**Interrupted**:
Ctrl+C during a Night Run. The run winds down at the next safe point: the in-flight Card is Bounced, the rest of the queue is reported as not started, the Morning Report lands, and the Runner exits 130. A second Ctrl+C exits immediately, without those guarantees.
_Avoid_: aborted (that is declining the Abort Prompt), cancelled
