# The Runner is a deterministic script, not a Claude orchestrator

A Night Run could be orchestrated by a Claude session (a loop that claims Cards and spawns subagents), but the whole point of Incubator is to spend the night's token budget on the Cards themselves. Orchestration is plain plumbing - fetch queue, loop, start session, update ticket, write report - so the Runner is a deterministic script and Claude only runs inside Card Sessions. Do not "upgrade" the Runner into an agent loop: predictability and 3 a.m. debuggability were chosen deliberately over flexibility.
