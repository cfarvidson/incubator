import type { Plan, PlanDeps } from "./types.js";

const REPO_LINE = /^Repo:\s*([\w.-]+\/[\w.-]+)\s*$/m;
const GOAL_HEADING = /^#{1,4}\s*(what to build|goal|problem)/im;
const VERIFICATION = /^#{1,4}\s*(acceptance criteria|verification)|^\s*- \[ \]/im;

/** Builds tonight's Plan: dry-run only, no side effects (CFA-167). */
export async function planNight(deps: PlanDeps): Promise<Plan> {
  const queue = await deps.linear.fetchNightQueue();
  // Linear priority 0 means "no priority", which sorts after low (4).
  const sorted = [...queue].sort(
    (a, b) => (a.priority === 0 ? 5 : a.priority) - (b.priority === 0 ? 5 : b.priority),
  );
  const plan: Plan = { runnable: [], bounced: [] };
  for (const card of sorted) {
    const repo = card.brief.match(REPO_LINE)?.[1];
    if (!repo) {
      plan.bounced.push({ card, reason: "Brief has no Repo Line (`Repo: owner/name`)" });
      continue;
    }
    if (!GOAL_HEADING.test(card.brief)) {
      plan.bounced.push({ card, reason: "Brief has no goal section (a `What to build`, `Goal`, or `Problem` heading)" });
      continue;
    }
    if (!VERIFICATION.test(card.brief)) {
      plan.bounced.push({
        card,
        reason: "Brief has no verification steps (an `Acceptance criteria`/`Verification` heading or `- [ ]` checklist)",
      });
      continue;
    }
    const clonePath = deps.resolveClone(repo);
    if (!clonePath) {
      plan.bounced.push({ card, reason: `No local clone found for ${repo} under the configured clone roots` });
      continue;
    }
    plan.runnable.push({ card, repo, clonePath });
  }
  return plan;
}
