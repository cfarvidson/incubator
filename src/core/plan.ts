import type { Plan, PlanDeps } from "./types.js";
import { bounceReasons, checkBrief } from "./brief.js";

/** Builds tonight's Plan: dry-run only, no side effects (CFA-167). */
export async function planNight(deps: PlanDeps): Promise<Plan> {
  const queue = await deps.linear.fetchNightQueue();
  const stranded = await deps.linear.fetchStranded();
  // Linear priority 0 means "no priority", which sorts after low (4).
  const sorted = [...queue].sort(
    (a, b) => (a.priority === 0 ? 5 : a.priority) - (b.priority === 0 ? 5 : b.priority),
  );
  const plan: Plan = { runnable: [], bounced: [], excluded: [] };
  for (const card of stranded) {
    // A Stranded Card was once runnable, so its team is onboarded - but the guard stays cheap.
    if (!card.teamHasNeedsInfo) {
      plan.excluded.push({ card, reason: "Team not onboarded: it has no `needs-info` label, so a Bounce cannot land" });
      continue;
    }
    plan.bounced.push({ card, reason: "Stranded: Claimed by an earlier Night Run that never finished" });
  }
  for (const card of sorted) {
    // Checked before the Brief: a Card in a team without `needs-info` cannot even be Bounced.
    if (!card.teamHasNeedsInfo) {
      plan.excluded.push({ card, reason: "Team not onboarded: it has no `needs-info` label, so a Bounce cannot land" });
      continue;
    }
    const checked = checkBrief(card.brief);
    if (!checked.runnable) {
      plan.bounced.push({ card, reason: checked.reason });
      continue;
    }
    const clonePath = deps.resolveClone(checked.repo);
    if (!clonePath) {
      plan.bounced.push({ card, reason: bounceReasons.noClone(checked.repo) });
      continue;
    }
    plan.runnable.push({ card, repo: checked.repo, clonePath });
  }
  return plan;
}
