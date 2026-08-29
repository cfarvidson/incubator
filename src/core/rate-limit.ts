import type { ClockPort } from "./types.js";

/** Thrown by a tracker adapter when the tracker's API reports rate limiting or exhausted quota. */
export class RateLimitError extends Error {}

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_CAP_MS = 15 * 60_000;

export interface RetryOptions {
  /** Called with the wait length before each backoff sleep, for the run log. */
  onWait?: (waitMs: number) => void;
}

/**
 * Rate limiting pauses the night, it never aborts it: retry with doubling
 * backoff (1 min up to 15 min between attempts). Any other error propagates
 * untouched. This wrapper is for tracker calls, which retry without a deadline;
 * a Card Session reports rate limiting as a `rate-limited` result instead, and
 * core retries it with the same Backoff only until the Stop Time.
 */
export async function withRateLimitRetry<T>(
  clock: ClockPort,
  fn: () => Promise<T>,
  { onWait }: RetryOptions = {},
): Promise<T> {
  let wait = BACKOFF_BASE_MS;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      onWait?.(wait);
      await clock.sleep(wait);
      wait = Math.min(wait * 2, BACKOFF_CAP_MS);
    }
  }
}
