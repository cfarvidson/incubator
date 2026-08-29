/**
 * The Brief contract: what a Card's body must contain to be runnable tonight.
 * This file is the single authority on the contract and on the Bounce reason
 * prose for a Brief defect; the Groom skill and README point here.
 */

const REPO_LINE = /^Repo:\s*([\w.-]+\/[\w.-]+)\s*$/m;
const GOAL_HEADING = /^#{1,4}\s*(what to build|goal|problem)/im;
const VERIFICATION = /^#{1,4}\s*(acceptance criteria|verification)|^\s*- \[ \]/im;

/** The Bounce reason for each way a Brief can fail its contract. */
export const bounceReasons = {
  noRepoLine: "Brief has no Repo Line (`Repo: owner/name`)",
  noGoal: "Brief has no goal section (a `What to build`, `Goal`, or `Problem` heading)",
  noVerification:
    "Brief has no verification steps (an `Acceptance criteria`/`Verification` heading or `- [ ]` checklist)",
  /** Used by planNight, which owns clone resolution; the prose still lives here. */
  noClone: (repo: string) => `No local clone found for ${repo} under the configured clone roots`,
} as const;

export type BriefCheck = { runnable: true; repo: string } | { runnable: false; reason: string };

/**
 * Checks a Brief against the contract: the target repo, or the first Bounce reason.
 * `homeRepo` is the repo the Card itself lives in, when the tracker knows it (GitHub);
 * a Brief without a Repo Line targets it instead of Bouncing.
 */
export function checkBrief(brief: string, homeRepo?: string): BriefCheck {
  const repo = brief.match(REPO_LINE)?.[1] ?? homeRepo;
  if (!repo) return { runnable: false, reason: bounceReasons.noRepoLine };
  if (!GOAL_HEADING.test(brief)) return { runnable: false, reason: bounceReasons.noGoal };
  if (!VERIFICATION.test(brief)) return { runnable: false, reason: bounceReasons.noVerification };
  return { runnable: true, repo };
}
