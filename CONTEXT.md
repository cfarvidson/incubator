# Incubator

Overnight execution of prepared work. Cards are prepared in Linear during the day; a manually started night run builds them unattended and leaves PRs and a report for the morning.

## Language

**Card**:
A Linear (work) issue assigned to me that describes one night-sized unit of work.
_Avoid_: ticket, task

**Brief**:
The fully specified body of a Card: a goal section (which carries the scope), verification steps, and a Repo Line. A Card without a complete Brief is Bounced, not run.
_Avoid_: spec, description

**Repo Line**:
The `Repo:` row at the top of a Brief naming the target repository the Card is built in.

**Night Queue**:
The Cards eligible to run tonight: assigned to me, state Todo, label `ready-for-agent`, anywhere in the Linear work workspace.
_Avoid_: backlog

**Night Run**:
One manually started, unattended execution of the Night Queue, from when I leave work until the queue is empty or the Stop Time is reached.

**Runner**:
The deterministic script that orchestrates a Night Run: shows the Plan, claims Cards, starts Card Sessions, updates Linear, writes the Morning Report. The Runner itself is not an agent.
_Avoid_: orchestrator, daemon

**Card Session**:
The headless Claude session that executes a single Card in its own git worktree of the target repository.

**Claim**:
Moving a Card from Todo to In Progress when the Runner picks it up, so no other run takes it.

**Bounce**:
Returning a Card to Todo with the `needs-info` label and an explanatory comment instead of (or after failing at) running it.

**Plan**:
The terminal listing shown when a Night Run starts: which Cards will run, in what order, and which were Bounced.

**Morning Report**:
The markdown file written in this repo at the end of a Night Run: per Card, the outcome and PR links.

**Duration Cap**:
The maximum wall-clock time one Card Session may run (default 2h). A Card hitting it has its session stopped and is Bounced.

**Stop Time**:
The clock time at which a Night Run stops starting new Cards.
