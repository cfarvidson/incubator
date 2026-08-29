/**
 * The Duration Cap: how long one Card Session may run before it is stopped and
 * its Card Bounced. One value owns the minutes-to-ms conversion and the prose
 * used in Bounce comments, so config (minutes), timers (ms), and comments ("2h")
 * can never drift apart.
 */
export interface DurationCap {
  ms: number;
  /** The Cap as Bounce-comment prose: whole hours as "2h", anything else as minutes. */
  prose: string;
}

export function durationCapFromMinutes(minutes: number): DurationCap {
  return {
    ms: minutes * 60_000,
    prose: minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`,
  };
}
