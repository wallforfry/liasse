export const MAX_SNIPPETS_PER_DOCUMENT = 3;

export interface ScoredChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly score: number;
}

export interface DocumentGroup {
  readonly documentId: string;
  readonly score: number;
  readonly chunkIds: readonly string[];
}

interface Ranked {
  readonly id: string;
  readonly score: number;
}

// Ids break the ties, so equal scores always come out in the same order.
const byScoreThenId = (left: Ranked, right: Ranked): number =>
  right.score - left.score || (left.id < right.id ? -1 : 1);

// A document scores what its best chunk scores, and shows that chunk plus its next best ones.
export const groupByDocument = (
  scoredChunks: readonly ScoredChunk[],
  limit: number,
): readonly DocumentGroup[] => {
  const groups = scoredChunks
    .map((chunk) => ({ ...chunk, id: chunk.chunkId }))
    .toSorted(byScoreThenId)
    .reduce((byDocument, { chunkId, documentId, score }) => {
      const group = byDocument.get(documentId);
      return byDocument.set(
        documentId,
        group === undefined
          ? { documentId, score, chunkIds: [chunkId] }
          : { ...group, chunkIds: [...group.chunkIds, chunkId] },
      );
    }, new Map<string, DocumentGroup>());
  return [...groups.values()]
    .map((group) => ({ ...group, id: group.documentId }))
    .toSorted(byScoreThenId)
    .slice(0, limit)
    .map(({ documentId, score, chunkIds }) => ({
      documentId,
      score,
      chunkIds: chunkIds.slice(0, MAX_SNIPPETS_PER_DOCUMENT),
    }));
};
