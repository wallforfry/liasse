import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, RRF_K } from './fusion.ts';

describe('reciprocalRankFusion', () => {
  it('uses k = 60', () => {
    expect(RRF_K).toBe(60);
  });

  it('sums 1 / (60 + rank) over the rankings, ranks starting at 1', () => {
    const scores = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'd', 'a'],
    ]);
    expect([...scores.keys()].toSorted()).toEqual(['a', 'b', 'c', 'd']);
    expect(scores.get('a')).toBeCloseTo(1 / 61 + 1 / 63, 15);
    expect(scores.get('b')).toBeCloseTo(1 / 62 + 1 / 61, 15);
    expect(scores.get('c')).toBeCloseTo(1 / 63, 15);
    expect(scores.get('d')).toBeCloseTo(1 / 62, 15);
    // 1/61 + 1/63 = 0.032266..., 1/62 + 1/61 = 0.032522...: agreement near the top wins.
    expect(scores.get('b')).toBeGreaterThan(scores.get('a') ?? 0);
    expect(scores.get('a')).toBeCloseTo(0.032_266_458_5, 10);
  });

  it('accepts another constant', () => {
    expect(reciprocalRankFusion([['a']], 0).get('a')).toBe(1);
  });

  it('scores nothing without candidates', () => {
    expect(reciprocalRankFusion([[], []]).size).toBe(0);
  });
});
