---
name: groom
description: Groom Cards so tonight's Night Run has a runnable queue - diagnose Bounced and needs-info Cards and repair their Briefs with the user. Use when the user wants to groom or prepare Cards for the night ("groom", "grooma korten", "gör i ordning korten inför natten", "vilka kort behöver hjälp"), or after a morning of Bounces.
---

# Groom

The daytime counterpart of a Night Run: find every Card of mine that cannot run tonight, repair each Brief together with the user, and leave the Night Queue clean. The Runner never judges - it Bounces on the first defect - so grooming is where the judgment happens.

## 1. Gather the ungroomed

Two sources, both required:

- `pnpm night --dry-run` (read-only, safe): tonight's Plan. The Bounced list is queued Cards whose Brief fails a check, each with the reason; the Excluded list is Cards from teams not onboarded.
- Linear: Cards assigned to me, state Todo, label `needs-info` - earlier Bounces that fell out of the queue. Load the `mcp__linear-work__*` tools via ToolSearch, then `list_issues` with that filter. For each hit, read the newest comment (`list_comments`): a Bounce comment says exactly what was missing.

The user can name extra Cards; add them to the pass. If both sources come back empty, say so and stop - nothing to groom.

## 2. Diagnose each Card

The Brief contract lives in `src/core/brief.ts` - that module is the authority; re-read it when in doubt. A runnable Brief has:

- A Repo Line: `Repo: owner/name` on its own line - the actual git repository, not an image or service name
- A goal heading (`What to build`, `Goal`, or `Problem`) whose section carries the scope
- Verification: an `Acceptance criteria`/`Verification` heading, or a `- [ ]` checklist
- A local clone of the repo under a configured clone root (`incubator.config.json` → `cloneRoots`)
- An onboarded team - see "Onboarding a team" in the README

Then judge what the Runner's regexes cannot: is the scope night-sized, is the verification checkable by a headless agent, does the Brief carry enough context to work unattended (file paths, existing patterns to follow, constraints)?

## 3. Repair, one Card at a time

Work through the list with the user, most-blocked first. For each Card:

1. Show the diagnosis: what blocks it, and what the Bounce comment said.
2. Ask only what the user knows and you cannot look up (which repo? what does done look like?). Draft the rest yourself: a rewritten Brief that preserves the user's intent and satisfies the contract.
3. On approval, apply it: `save_issue` with the new description and the labels swapped `needs-info` → `ready-for-agent`, state Todo.
4. A Card the user decides not to run tonight is Parked: leave it untouched and note the reason.

An Excluded Card is blocked on its team, not its Brief: offer to onboard the team (create the missing labels per the README) or to move the Card to an onboarded team.

Never widen scope while rewriting. A Brief needing more than a night should be split - offer to create the follow-up Card - or Parked.

## 4. Confirm

Re-run `pnpm night --dry-run`. Done when every Card in the pass is either in the runnable list or Parked with a reason. Summarize: how many Cards queued for tonight, how many Parked and why.
