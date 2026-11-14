export const RRF_K = 60;

// Reciprocal Rank Fusion: an item scores 1 / (k + rank) in every ranking that holds it, ranks
// starting at 1, and its fused score is the sum.
export const reciprocalRankFusion = (
  rankings: readonly (readonly string[])[],
  k: number = RRF_K,
): ReadonlyMap<string, number> =>
  rankings
    .flatMap((ranking) => ranking.map((id, index) => ({ id, score: 1 / (k + index + 1) })))
    .reduce(
      (scores, { id, score }) => scores.set(id, (scores.get(id) ?? 0) + score),
      new Map<string, number>(),
    );
