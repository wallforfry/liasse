import { describe, expect, it } from 'vitest';
import { createNotReadyDelay, NOT_READY_DELAY } from './execution.ts';

describe('createNotReadyDelay', () => {
  it('doubles the deferral of one settings version up to its cap', () => {
    const delayOf = createNotReadyDelay();
    const delays = Array.from({ length: 12 }, () => delayOf(2));
    expect(delays.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(Math.max(...delays)).toBe(NOT_READY_DELAY.maxMs);
    expect(delays.at(-1)).toBe(NOT_READY_DELAY.maxMs);
  });

  it('starts again from the first delay for another version', () => {
    const delayOf = createNotReadyDelay();
    delayOf(2);
    delayOf(2);
    expect(delayOf(3)).toBe(NOT_READY_DELAY.firstMs);
  });
});
