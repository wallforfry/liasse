import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.ts';

describe('parseDuration', () => {
  it.each([
    ['250ms', 250],
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
    ['2w', 1_209_600_000],
    [' 7d ', 604_800_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '7', 'd', '7 d', '-1d', '1.5h', '7days', '0d', '99999999999999999999d'])(
    'rejects %j',
    (input) => {
      expect(parseDuration(input)).toBeUndefined();
    },
  );
});
