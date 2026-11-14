import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunks } from '../db/schema/documents.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { readSnippets, toExcerpt } from './snippets.ts';
import { parseSearchQuery } from './tsquery.ts';

const START = '\u{E000}';
const END = '\u{E001}';

describe('toExcerpt', () => {
  it('returns a headline without match as it is', () => {
    expect(toExcerpt('Opening words of the chunk')).toEqual({
      text: 'Opening words of the chunk',
      highlights: [],
    });
  });

  it('takes the marks out and gives the range of each match', () => {
    const excerpt = toExcerpt(`Facture d’${START}électricité${END} de ${START}mars${END} 2026`);
    expect(excerpt).toEqual({
      text: 'Facture d’électricité de mars 2026',
      highlights: [
        { start: 10, end: 21 },
        { start: 25, end: 29 },
      ],
    });
    expect(excerpt.highlights.map(({ start, end }) => excerpt.text.slice(start, end))).toEqual([
      'électricité',
      'mars',
    ]);
  });

  it('cuts the text at the bound, the highlight that straddles it included', () => {
    expect(toExcerpt(`ab ${START}cdef${END} gh ${START}ij${END}`, 5)).toEqual({
      text: 'ab cd',
      highlights: [{ start: 3, end: 5 }],
    });
    expect(toExcerpt(`ab ${START}cdef${END}`, 3)).toEqual({ text: 'ab ', highlights: [] });
  });

  it('does not cut a surrogate pair in two', () => {
    expect(toExcerpt('ab😀cd', 3).text).toBe('ab');
    expect(toExcerpt('ab😀cd', 4).text).toBe('ab😀');
  });
});

describe('readSnippets', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const chunkOf = async (status: 'indexed' | 'deleted'): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, { status });
    const [chunk] = await database.db
      .insert(chunks)
      .values({ documentId: id, pageFrom: 2, pageTo: 2, text: 'Total due: 84.20 EUR' })
      .returning({ id: chunks.id });
    if (chunk === undefined) throw new Error('the chunk was not inserted');
    return chunk.id;
  };

  it('excerpts the chunks of live documents only', async () => {
    const live = await chunkOf('indexed');
    const tombstone = await chunkOf('deleted');
    const tsquery = (await parseSearchQuery(database.db, 'total')) ?? '';
    const snippets = await readSnippets(database.db, [live, tombstone], tsquery);
    expect([...snippets.keys()]).toEqual([live]);
    expect(snippets.get(live)).toEqual({
      text: 'Total due: 84.20 EUR',
      highlights: [{ start: 0, end: 5 }],
      pageFrom: 2,
      pageTo: 2,
    });
  });
});
