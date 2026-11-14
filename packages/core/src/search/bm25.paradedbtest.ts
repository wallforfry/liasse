import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { BM25_INDEX, rankByBm25 } from './bm25.ts';
import { CORPUS, type CorpusDocument, seedCorpus, type SeededCorpus } from './corpus.fixture.ts';
import { documentFilter } from './filters.ts';
import { prepareFullTextRanking } from './full-text-ranking.ts';
import type { SearchFilters } from './input.ts';
import { installedPgSearchVersion } from './pg-search.ts';
import { type ChunkRanker, rankByFullText, type RankRequest } from './rankers.ts';
import { search } from './search.ts';
import { parseSearchQuery } from './tsquery.ts';

const extra = (key: string, text: string): CorpusDocument => ({
  key,
  title: key,
  type: 'warranty',
  language: null,
  pages: [text],
});

const indexAccessMethod = async (database: TestDatabase): Promise<unknown> =>
  (
    await database.db.execute(sql`
      SELECT am.amname AS method
      FROM pg_class AS index
      JOIN pg_am AS am ON am.oid = index.relam
      WHERE index.relname = ${BM25_INDEX}
    `)
  )[0]?.method;

describe('BM25 ranking through ParadeDB pg_search', () => {
  let database: TestDatabase;
  let corpus: SeededCorpus;

  beforeAll(async () => {
    database = await createTestDatabase();
    corpus = await seedCorpus(database.db, createFakeEmbedder());
  });

  afterAll(async () => {
    await database.dispose();
  });

  const request = async (query: string, filters: SearchFilters = {}): Promise<RankRequest> => ({
    query,
    tsquery: (await parseSearchQuery(database.db, query)) ?? '',
    filter: documentFilter(filters, true),
    limit: 100,
  });

  const keysBy = async (
    ranker: ChunkRanker,
    query: string,
    filters?: SearchFilters,
  ): Promise<readonly string[]> =>
    (await ranker(database.db, await request(query, filters))).map((chunk) =>
      corpus.keyOf(chunk.documentId),
    );

  it('runs on a database where pg_search is installed', async () => {
    expect(await installedPgSearchVersion(database.db)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('connects with the planner warnings of pg_search off', async () => {
    const [row] = await database.db.execute(
      sql`SELECT lower(current_setting('paradedb.planner_warnings')) AS setting`,
    );
    expect(row?.setting).toBe('off');
  });

  it('chooses BM25 and creates its index, once', async () => {
    expect(await indexAccessMethod(database)).toBeUndefined();
    const version = await installedPgSearchVersion(database.db);
    const ranking = await prepareFullTextRanking(database.db);
    expect(ranking).toEqual({
      ranker: rankByBm25,
      notice: `Full text is ranked by BM25 (pg_search ${String(version)}).`,
    });
    expect(await indexAccessMethod(database)).toBe('paradedb');
    expect((await prepareFullTextRanking(database.db)).ranker).toBe(rankByBm25);
  });

  describe('once the index exists', () => {
    beforeAll(async () => {
      await prepareFullTextRanking(database.db);
    });

    it.each([
      ['facture', true],
      ['factures', true],
      ['electricite', true],
      ['ÉLECTRICITÉ', true],
      ['résilier', true],
      ['payslips', true],
      ['contribution', true],
      ['certificate', true],
      ['ZX4103', true],
      ['facture septembre', true],
      ['"Harbor Homes" March', true],
      ['facture -septembre', true],
      ['payslip or receipts', true],
      ['-facture', true],
      ['payslip or -facture', true],
      ['certificates', false],
      ['facture Northwind', false],
    ])('matches the chunks rankByFullText matches for %j', async (query, found) => {
      const byBm25 = await keysBy(rankByBm25, query);
      const byTsRank = await keysBy(rankByFullText, query);
      expect(byBm25.toSorted()).toEqual(byTsRank.toSorted());
      expect(byBm25.length > 0).toBe(found);
    });

    it('applies the document filter', async () => {
      expect(await keysBy(rankByBm25, 'facture', { type: 'payslip' })).toEqual([]);
      expect((await keysBy(rankByBm25, 'facture', { dateFrom: '2026-11-01' })).toSorted()).toEqual([
        'energy-11',
        'energy-12',
      ]);
    });

    it.each([
      '"unbalanced ((( & | !',
      'OR',
      '-',
      "'; DROP TABLE chunks; --",
      'title:facture AND (septembre OR',
      'facture~2 ^3 * ? \\ [a TO z] {b TO c}',
      '"',
    ])('does not raise for %j, and matches what rankByFullText matches', async (query) => {
      const byBm25 = await keysBy(rankByBm25, query);
      expect(byBm25.toSorted()).toEqual((await keysBy(rankByFullText, query)).toSorted());
    });

    it('ranks a short chunk with the term above a long one that repeats it', async () => {
      const filler = Array.from({ length: 150 }, (_, index) => `filler${String(index)}`).join(' ');
      await corpus.add(extra('quartz-long', `quartz ${filler} quartz`));
      await corpus.add(extra('quartz-short', 'quartz crystal'));
      expect(await keysBy(rankByBm25, 'quartz')).toEqual(['quartz-short', 'quartz-long']);
      expect(await keysBy(rankByFullText, 'quartz')).toEqual(['quartz-long', 'quartz-short']);
    });

    it('gives a rare term more weight than a common one', async () => {
      await corpus.add(extra('slate-common', 'granite granite granite slate'));
      await corpus.add(extra('slate-rare', 'granite slate slate slate'));
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          corpus.add(extra(`granite-${String(index)}`, `granite block ${String(index)}`)),
        ),
      );
      expect(await keysBy(rankByBm25, 'granite slate')).toEqual(['slate-rare', 'slate-common']);
    });

    it('leaves a tombstone out', async () => {
      const id = await corpus.add(extra('tombstone', 'basalt basalt basalt'));
      expect(await keysBy(rankByBm25, 'basalt')).toEqual(['tombstone']);
      await database.db.update(documents).set({ status: 'deleted' }).where(eq(documents.id, id));
      expect(await keysBy(rankByBm25, 'basalt')).toEqual([]);
    });

    it('serves hybrid search', async () => {
      const hits = await search(
        { db: database.db, embedder: createFakeEmbedder(), fullText: rankByBm25 },
        { query: 'facture septembre' },
      );
      expect(hits[0]?.title).toBe(CORPUS.find((document) => document.key === 'energy-09')?.title);
    });
  });
});

describe('a database where pg_search is not created', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
    await database.db.execute(sql`DROP EXTENSION pg_search`);
    await seedCorpus(database.db, createFakeEmbedder());
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('ranks by ts_rank_cd and creates no index', async () => {
    expect(await prepareFullTextRanking(database.db)).toEqual({
      ranker: rankByFullText,
      notice: undefined,
    });
    expect(await indexAccessMethod(database)).toBeUndefined();
    const hits = await search(
      { db: database.db, embedder: createFakeEmbedder() },
      { query: 'facture septembre' },
    );
    expect(hits[0]?.title).toBe(CORPUS.find((document) => document.key === 'energy-09')?.title);
  });
});
