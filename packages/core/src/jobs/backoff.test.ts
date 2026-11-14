import { describe, expect, it } from 'vitest';
import { retryDelayMs } from './backoff.ts';

describe('retryDelayMs', () => {
  const policy = { baseMs: 1000, maxMs: 10_000 };

  it('doubles the delay at every failed attempt', () => {
    expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, policy))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it('never exceeds the maximum', () => {
    expect(retryDelayMs(5, policy)).toBe(10_000);
    expect(retryDelayMs(60, policy)).toBe(10_000);
  });
});
