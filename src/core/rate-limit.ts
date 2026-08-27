import type { ClockPort } from "./types.js";

/** Thrown by adapters when the Claude CLI or the Linear API reports rate limiting or exhausted quota. */
export class RateLimitError extends Error {}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 15 * 60_000;

/**
 * Rate limiting pauses the night, it never aborts it: retry indefinitely with
 * doubling backoff (1 min up to 15 min between attempts). Any other error
 * propagates untouched.
 */
export async function withRateLimitRetry<T>(clock: ClockPort, fn: () => Promise<T>): Promise<T> {
  let wait = BACKOFF_BASE_MS;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      await clock.sleep(wait);
      wait = Math.min(wait * 2, BACKOFF_CAP_MS);
    }
  }
}
