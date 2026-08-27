import type { ClockPort } from "./types.js";

/** Thrown by adapters when the Claude CLI or the Linear API reports rate limiting or exhausted quota. */
export class RateLimitError extends Error {}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 15 * 60_000;

export interface RetryOptions {
  /** A rate limit seen once the clock passes this is rethrown instead of retried. */
  retryUntil?: Date;
  /** Called with the wait length before each backoff sleep, for the run log. */
  onWait?: (waitMs: number) => void;
}

/**
 * Rate limiting pauses the night, it never aborts it: retry with doubling
 * backoff (1 min up to 15 min between attempts). Any other error propagates
 * untouched. With `retryUntil`, a rate limit seen once the clock passes it is
 * rethrown instead of retried - so a rate-limited Card Session cannot keep
 * starting new sessions past the Stop Time.
 */
export async function withRateLimitRetry<T>(
  clock: ClockPort,
  fn: () => Promise<T>,
  { retryUntil, onWait }: RetryOptions = {},
): Promise<T> {
  let wait = BACKOFF_BASE_MS;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      if (retryUntil && clock.now() >= retryUntil) throw error;
      onWait?.(wait);
      await clock.sleep(wait);
      wait = Math.min(wait * 2, BACKOFF_CAP_MS);
    }
  }
}
