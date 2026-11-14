export interface RetryPolicy {
  /** Delay before the second attempt; it doubles at every further attempt. */
  readonly baseMs: number;
  readonly maxMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { baseMs: 5000, maxMs: 600_000 };

export const retryDelayMs = (failedAttempt: number, { baseMs, maxMs }: RetryPolicy): number =>
  Math.min(maxMs, baseMs * 2 ** (failedAttempt - 1));
