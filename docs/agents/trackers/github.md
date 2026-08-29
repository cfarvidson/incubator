# Cards on GitHub Issues (Tracker Profiles with `"kind": "github"`)

How Cards look when the active Tracker Profile points at GitHub. Use the `gh` CLI. GitHub has no workflow states, so labels carry them.

- **A Card**: an open GitHub issue assigned to me, in a repo/owner within the profile's `scope`. The Brief is the issue body; a Brief without a Repo Line targets the issue's own repo.
- **Night Queue**: label `ready-for-agent`, not labelled `in-progress`. `gh search issues --assignee @me --state open --label ready-for-agent -- -label:in-progress`.
- **Claimed**: label `in-progress` added, with a `Night Run: Claimed.` comment.
- **Done for the night**: labels `ready-for-agent` and `in-progress` removed, `in-review` added, comment `Night Run result: done.` with PR links.
- **Bounced**: labels swapped to `needs-info`, comment `Night Run result: Bounced.` with the reason.
- **Re-queue after grooming**: fix the issue body, then `gh issue edit <url> --remove-label needs-info --add-label ready-for-agent`.
- **Onboarded repo**: has a `needs-info` label (`gh label create needs-info -R owner/name`). The Runner creates `in-progress`/`in-review` itself when first needed.
- **Priority**: labels `priority:urgent` / `priority:high` / `priority:medium` / `priority:low`; unlabeled runs last.
