import { describe, expect, it } from 'vitest';
import { groupByDocument, MAX_SNIPPETS_PER_DOCUMENT, type ScoredChunk } from './grouping.ts';

const chunk = (chunkId: string, documentId: string, score: number): ScoredChunk => ({
  chunkId,
  documentId,
  score,
});

describe('groupByDocument', () => {
  it('shows the best chunk and at most two more', () => {
    expect(MAX_SNIPPETS_PER_DOCUMENT).toBe(3);
  });

  it('scores a document by its best chunk and orders documents by that score', () => {
    expect(
      groupByDocument(
        [
          chunk('c1', 'doc_a', 0.2),
          chunk('c2', 'doc_b', 0.5),
          chunk('c3', 'doc_a', 0.4),
          chunk('c4', 'doc_c', 0.3),
        ],
        10,
      ),
    ).toEqual([
      { documentId: 'doc_b', score: 0.5, chunkIds: ['c2'] },
      { documentId: 'doc_a', score: 0.4, chunkIds: ['c3', 'c1'] },
      { documentId: 'doc_c', score: 0.3, chunkIds: ['c4'] },
    ]);
  });

  it('does not add up the chunks of a document', () => {
    const [first] = groupByDocument(
      [chunk('c1', 'doc_a', 0.3), chunk('c2', 'doc_a', 0.3), chunk('c3', 'doc_b', 0.5)],
      10,
    );
    expect(first?.documentId).toBe('doc_b');
  });

  it('keeps the three best chunks of a document, best first', () => {
    expect(
      groupByDocument(
        [
          chunk('c1', 'doc_a', 0.1),
          chunk('c2', 'doc_a', 0.5),
          chunk('c3', 'doc_a', 0.3),
          chunk('c4', 'doc_a', 0.2),
          chunk('c5', 'doc_a', 0.4),
        ],
        10,
      ),
    ).toEqual([{ documentId: 'doc_a', score: 0.5, chunkIds: ['c2', 'c5', 'c3'] }]);
  });

  it('breaks ties by id, whatever the input order', () => {
    const tied = [
      chunk('c4', 'doc_b', 0.5),
      chunk('c2', 'doc_a', 0.5),
      chunk('c3', 'doc_b', 0.5),
      chunk('c1', 'doc_c', 0.5),
    ];
    const expected = [
      { documentId: 'doc_a', score: 0.5, chunkIds: ['c2'] },
      { documentId: 'doc_b', score: 0.5, chunkIds: ['c3', 'c4'] },
      { documentId: 'doc_c', score: 0.5, chunkIds: ['c1'] },
    ];
    expect(groupByDocument(tied, 10)).toEqual(expected);
    expect(groupByDocument(tied.toReversed(), 10)).toEqual(expected);
  });

  it('returns at most `limit` documents, the best ones', () => {
    expect(
      groupByDocument(
        [chunk('c1', 'doc_a', 0.1), chunk('c2', 'doc_b', 0.3), chunk('c3', 'doc_c', 0.2)],
        2,
      ).map((group) => group.documentId),
    ).toEqual(['doc_b', 'doc_c']);
  });
});
