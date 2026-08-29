/**
 * The Claim marker and Stranded detection, shared by every tracker adapter:
 * a Card is Stranded when its latest Night Run comment is a Claim with no
 * terminal result after it - the run died between Claim and outcome.
 */

/** The Claim marker; every terminal outcome comment starts with "Night Run result:" instead. */
export const CLAIM_COMMENT =
  "Night Run: Claimed. If no `Night Run result:` comment follows, the run died and this Card is Stranded.";

/** Comment bodies in chronological order; human comments neither strand nor resolve. */
export function isStranded(commentBodiesOldestFirst: string[]): boolean {
  const lastNightRunComment = [...commentBodiesOldestFirst].reverse().find((body) => body.startsWith("Night Run"));
  return lastNightRunComment?.startsWith("Night Run: Claimed.") ?? false;
}
