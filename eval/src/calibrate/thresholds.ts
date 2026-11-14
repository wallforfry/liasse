import type { Embedding } from '@liasse/core/models';
import type { Corpus } from '../schema/index.ts';

/** One name an entity of the corpus goes by. */
export interface EntityName {
  readonly entity: string;
  readonly kind: string;
  readonly name: string;
}

export interface SimilarityThresholdPair {
  readonly attach: number;
  readonly arbitrate: number;
}

export interface Spread {
  readonly pairs: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
}

export interface Calibration {
  /** Two names of one entity: the rule should attach them, or at least arbitrate. */
  readonly same: Spread;
  /** Names of two entities of one kind: the rule must not attach them. */
  readonly different: Spread;
  readonly current: ThresholdOutcomes;
  /** Null when the corpus has no pair of one of the two sorts to measure. */
  readonly suggested: ThresholdOutcomes | null;
}

/** What a pair of thresholds does with the pairs of names measured. */
export interface ThresholdOutcomes extends SimilarityThresholdPair {
  readonly sameAttached: number;
  readonly sameBelowArbitrate: number;
  readonly differentAttached: number;
  readonly differentArbitrated: number;
}

/** Every name of every entity, canonical name and aliases, once each. */
export const entityNamesOf = ({ entities }: Pick<Corpus, 'entities'>): readonly EntityName[] =>
  entities.flatMap(({ key, kind, canonical_name, aliases }) =>
    [...new Set([canonical_name, ...aliases])].map((name) => ({ entity: key, kind, name })),
  );

const cosine = (left: Embedding, right: Embedding): number => {
  const dot = left.reduce((sum, value, axis) => sum + value * (right[axis] ?? 0), 0);
  const norm = (vector: Embedding) =>
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(left) * norm(right));
};

const spread = (values: readonly number[]): Spread => {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    pairs: sorted.length,
    min: sorted[0] ?? null,
    median: sorted[Math.floor(sorted.length / 2)] ?? null,
    max: sorted.at(-1) ?? null,
  };
};

// Two decimals, on the safe side of the measured value.
const up = (value: number): number => Math.ceil(value * 100) / 100;
const down = (value: number): number => Math.floor(value * 100) / 100;

/**
 * Measures the similarity rule of entity resolution on the names of the corpus: the
 * cosine of every pair of names of one kind, as `similarEntities` compares them. The
 * suggestion attaches no two entities (`attach` at or above the closest pair of distinct
 * names, the rule attaching strictly above it) and sends every alias at least to
 * arbitration (`arbitrate` at or below the farthest pair of one entity's names, and never
 * above `attach`: when the two sorts do not overlap, nothing is left to arbitrate).
 */
export const calibrate = (
  names: readonly EntityName[],
  embeddings: readonly Embedding[],
  current: SimilarityThresholdPair,
): Calibration => {
  const pairs = names.flatMap((left, i) =>
    names.slice(i + 1).flatMap((right, offset) => {
      const [a, b] = [embeddings[i], embeddings[i + 1 + offset]];
      if (a === undefined || b === undefined || left.kind !== right.kind) return [];
      return [{ same: left.entity === right.entity, similarity: cosine(a, b) }];
    }),
  );
  const same = pairs.filter((pair) => pair.same).map(({ similarity }) => similarity);
  const different = pairs.filter((pair) => !pair.same).map(({ similarity }) => similarity);
  const [sameSpread, differentSpread] = [spread(same), spread(different)];
  const count = (values: readonly number[], keep: (value: number) => boolean) =>
    values.filter(keep).length;
  const outcomes = (thresholds: SimilarityThresholdPair): ThresholdOutcomes => ({
    ...thresholds,
    sameAttached: count(same, (value) => value > thresholds.attach),
    sameBelowArbitrate: count(same, (value) => value < thresholds.arbitrate),
    differentAttached: count(different, (value) => value > thresholds.attach),
    differentArbitrated: count(different, (value) => value >= thresholds.arbitrate),
  });
  const attach = differentSpread.max === null ? null : up(differentSpread.max);
  const arbitrate = sameSpread.min === null ? null : down(sameSpread.min);
  return {
    same: sameSpread,
    different: differentSpread,
    current: outcomes(current),
    suggested:
      attach === null || arbitrate === null
        ? null
        : outcomes({ attach, arbitrate: Math.min(arbitrate, attach) }),
  };
};
