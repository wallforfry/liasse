import {
  ENTITY_ARBITRATION_CANDIDATES,
  ENTITY_ARBITRATION_SIMILARITY,
  ENTITY_ATTACH_SIMILARITY,
} from '@liasse/contract/domain';

export interface SimilarityThresholds {
  // Above it, the closest candidate is attached without asking.
  readonly attach: number;
  // From it up to `attach`, the candidates are arbitrated.
  readonly arbitrate: number;
  // How many of the closest candidates are looked at.
  readonly candidates: number;
}

export const ENTITY_SIMILARITY: SimilarityThresholds = {
  attach: ENTITY_ATTACH_SIMILARITY,
  arbitrate: ENTITY_ARBITRATION_SIMILARITY,
  candidates: ENTITY_ARBITRATION_CANDIDATES,
};

export type SimilarityDecision<Candidate> =
  | { readonly outcome: 'attach'; readonly candidate: Candidate }
  | { readonly outcome: 'arbitrate'; readonly candidates: readonly Candidate[] }
  | { readonly outcome: 'none' };

// The third rule of resolution, for anything that is resolved by similarity. Takes the
// candidates closest first.
export const decideBySimilarity = <Candidate extends { readonly similarity: number }>(
  closest: readonly Candidate[],
  thresholds: SimilarityThresholds,
): SimilarityDecision<Candidate> => {
  const [first] = closest;
  if (first !== undefined && first.similarity > thresholds.attach) {
    return { outcome: 'attach', candidate: first };
  }
  const candidates = closest
    .slice(0, thresholds.candidates)
    .filter(({ similarity }) => similarity >= thresholds.arbitrate);
  return candidates.length === 0 ? { outcome: 'none' } : { outcome: 'arbitrate', candidates };
};
