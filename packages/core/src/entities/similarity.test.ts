import {
  ENTITY_ARBITRATION_CANDIDATES,
  ENTITY_ARBITRATION_SIMILARITY,
  ENTITY_ATTACH_SIMILARITY,
} from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { decideBySimilarity, ENTITY_SIMILARITY } from './similarity.ts';

const candidate = (id: string, similarity: number) => ({ id, similarity });

describe('ENTITY_SIMILARITY', () => {
  it('carries the thresholds of the specification', () => {
    expect(ENTITY_SIMILARITY).toEqual({ attach: 0.92, arbitrate: 0.8, candidates: 3 });
    expect([
      ENTITY_ATTACH_SIMILARITY,
      ENTITY_ARBITRATION_SIMILARITY,
      ENTITY_ARBITRATION_CANDIDATES,
    ]).toEqual([0.92, 0.8, 3]);
  });
});

describe('decideBySimilarity', () => {
  const thresholds = { attach: 0.9, arbitrate: 0.5, candidates: 2 };

  it('attaches the closest candidate above the first threshold', () => {
    const closest = [candidate('a', 0.95), candidate('b', 0.93)];
    expect(decideBySimilarity(closest, thresholds)).toEqual({
      outcome: 'attach',
      candidate: closest[0],
    });
  });

  it('arbitrates at the first threshold exactly', () => {
    expect(decideBySimilarity([candidate('a', 0.9)], thresholds)).toEqual({
      outcome: 'arbitrate',
      candidates: [candidate('a', 0.9)],
    });
  });

  it('arbitrates at the second threshold exactly, and not under it', () => {
    expect(decideBySimilarity([candidate('a', 0.5)], thresholds).outcome).toBe('arbitrate');
    expect(decideBySimilarity([candidate('a', 0.49)], thresholds)).toEqual({ outcome: 'none' });
  });

  it('keeps the number of candidates asked for, and only those within the band', () => {
    expect(
      decideBySimilarity(
        [candidate('a', 0.8), candidate('b', 0.7), candidate('c', 0.6)],
        thresholds,
      ),
    ).toEqual({ outcome: 'arbitrate', candidates: [candidate('a', 0.8), candidate('b', 0.7)] });
    expect(decideBySimilarity([candidate('a', 0.8), candidate('b', 0.4)], thresholds)).toEqual({
      outcome: 'arbitrate',
      candidates: [candidate('a', 0.8)],
    });
  });

  it('decides nothing without a candidate', () => {
    expect(decideBySimilarity([], thresholds)).toEqual({ outcome: 'none' });
  });
});
