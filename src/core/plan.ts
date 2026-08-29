import type { Plan, PlanDeps } from "./types.js";
import { bounceReasons, checkBrief } from "./brief.js";

/** Display names for the priority scale the Night Queue sorts by (0 = none, sorted last). */
export const PRIORITY_NAMES: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };

const NOT_ONBOARDED = "Not onboarded: no `needs-info` label exists where this Card lives, so a Bounce cannot land";

/** Builds tonight's Plan: dry-run only, no side effects (CFA-167). */
export async function planNight(deps: PlanDeps): Promise<Plan> {
  const queue = await deps.tracker.fetchNightQueue();
  const stranded = await deps.tracker.fetchStranded();
  // Priority 0 means "no priority", which sorts after low (4).
  const sorted = [...queue].sort(
    (a, b) => (a.priority === 0 ? 5 : a.priority) - (b.priority === 0 ? 5 : b.priority),
  );
  const plan: Plan = { runnable: [], bounced: [], excluded: [] };
  for (const card of stranded) {
    // A Stranded Card was once runnable, so it is onboarded - but the guard stays cheap.
    if (!card.canBounce) {
      plan.excluded.push({ card, reason: NOT_ONBOARDED });
      continue;
    }
    plan.bounced.push({ card, reason: "Stranded: Claimed by an earlier Night Run that never finished" });
  }
  for (const card of sorted) {
    // Checked before the Brief: a Card without a `needs-info` label in reach cannot even be Bounced.
    if (!card.canBounce) {
      plan.excluded.push({ card, reason: NOT_ONBOARDED });
      continue;
    }
    const checked = checkBrief(card.brief, card.homeRepo);
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
