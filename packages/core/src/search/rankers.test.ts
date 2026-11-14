import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';
import type { Embedder, EmbeddingKind } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { CORPUS, type CorpusDocument, seedCorpus, type SeededCorpus } from './corpus.fixture.ts';
import { documentFilter } from './filters.ts';
import type { SearchFilters } from './input.ts';
import {
  fullTextCandidates,
  rankByFullText,
  rankByVector,
  type RankRequest,
  vectorCandidates,
} from './rankers.ts';

const keysOfType = (type: string): readonly string[] =>
  CORPUS.filter((document) => document.type === type).map((document) => document.key);

const ENERGY_BILLS = [...keysOfType('energy_bill'), ...keysOfType('legacy_power_bill')];

const extra = (key: string, text: string, overrides: Partial<CorpusDocument> = {}) => ({
  key,
  title: key,
  type: 'warranty',
  language: null,
  pages: [text],
  ...overrides,
});

describe('chunk rankers', () => {
  let database: TestDatabase;
  let corpus: SeededCorpus;

  beforeAll(async () => {
    database = await createTestDatabase();
    corpus = await seedCorpus(database.db, createFakeEmbedder());
  });

  afterAll(async () => {
    await database.dispose();
  });

  const request = (query: string, filters: SearchFilters = {}, limit = 100): RankRequest => ({
    query,
    filter: documentFilter(filters, true),
    limit,
  });

  const fullText = async (query: string, filters?: SearchFilters, limit?: number) =>
    (await rankByFullText(database.db, request(query, filters, limit))).map((chunk) =>
      corpus.keyOf(chunk.documentId),
    );

  const byVector = async (query: string, filters?: SearchFilters, limit?: number) =>
    (await rankByVector(createFakeEmbedder())(database.db, request(query, filters, limit))).map(
      (chunk) => corpus.keyOf(chunk.documentId),
    );

  describe('rankByFullText', () => {
    it.each([
      ['Brisa', ['warranty-02']],
      ['ZX4103', ['warranty-04']],
      ['facture septembre', ['energy-09']],
      ['"Harbor Homes" March', ['rent-03']],
    ])('finds the exact terms of %j', async (query, expected) => {
      expect(await fullText(query)).toEqual(expected);
    });

    it.each([
      ['factures', ENERGY_BILLS],
      ['electricite', ENERGY_BILLS],
      ['ÉLECTRICITÉ', ENERGY_BILLS],
      ['resiliation', ['insurance-03']],
      ['résilier', ['insurance-03']],
      ['payslips', keysOfType('payslip')],
      ['contribution', keysOfType('payslip')],
      ['receipts', keysOfType('rent_receipt')],
    ])('finds another form of %j in the language of the document', async (query, expected) => {
      expect((await fullText(query)).toSorted()).toEqual(expected.toSorted());
    });

    it('matches a text of unknown language on its exact words only', async () => {
      expect((await fullText('certificate')).toSorted()).toEqual(keysOfType('warranty'));
      expect(await fullText('certificates')).toEqual([]);
    });

    it('requires every term', async () => {
      expect(await fullText('facture Northwind')).toEqual([]);
    });

    it.each(['"unbalanced ((( & | !', 'OR', '-', "'; DROP TABLE chunks; --"])(
      'returns nothing, and does not raise, for %j',
      async (query) => {
        expect(await fullText(query)).toEqual([]);
      },
    );

    it('ranks the denser match first and breaks ties by chunk id', async () => {
      await corpus.add(extra('zephyr-once', 'zephyr and nothing else of note in this text'));
      await corpus.add(extra('zephyr-thrice', 'zephyr zephyr zephyr'));
      await corpus.add(extra('zephyr-once-again', 'zephyr and nothing else of note in this text'));
      expect(await fullText('zephyr')).toEqual([
        'zephyr-thrice',
        'zephyr-once',
        'zephyr-once-again',
      ]);
    });

    it('returns at most `limit` chunks', async () => {
      expect(await fullText('facture', {}, 5)).toHaveLength(5);
    });

    it('applies the document filter', async () => {
      expect(await fullText('facture', { type: 'payslip' })).toEqual([]);
      expect(await fullText('facture', { dateFrom: '2026-11-01' })).toEqual([
        'energy-11',
        'energy-12',
      ]);
    });
  });

  describe('rankByVector', () => {
    it('embeds the query as a query', async () => {
      const calls: { texts: readonly string[]; kind: EmbeddingKind }[] = [];
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        embed: (texts, kind) => {
          calls.push({ texts, kind });
          return createFakeEmbedder().embed(texts, kind);
        },
      };
      await rankByVector(embedder)(database.db, request('salary'));
      expect(calls).toEqual([{ texts: ['salary'], kind: 'query' }]);
    });

    it('orders chunks by cosine distance to the query', async () => {
      const [first, second] = await byVector('Payslip March 2026 Northwind Robotics gross salary');
      expect(first).toBe('payslip-03');
      expect(second).toMatch(/^payslip-/);
    });

    it('returns at most `limit` chunks', async () => {
      expect(await byVector('salary', {}, 7)).toHaveLength(7);
    });

    it('applies the document filter', async () => {
      const keys = await byVector('salary', { type: 'warranty', status: 'needs_review' });
      expect(keys.toSorted()).toEqual(['warranty-01', 'warranty-02']);
    });

    it('leaves out the chunks that have no embedding', async () => {
      await corpus.add(
        extra('unembedded', 'quasar quasar quasar', { private: true }),
        createFakeEmbedder({ isLocal: false }),
      );
      expect(await byVector('quasar quasar quasar')).not.toContain('unembedded');
      expect(await fullText('quasar')).toEqual(['unembedded']);
    });

    it('rejects when the embedder fails', async () => {
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        embed: () => Promise.reject(new Error('synthetic embedder outage')),
      };
      await expect(rankByVector(embedder)(database.db, request('salary'))).rejects.toThrow(
        'synthetic embedder outage',
      );
    });
  });

  describe('query plans', () => {
    const FILTERS: SearchFilters = {
      type: 'energy_bill',
      subject: 'sub_synthetic_home',
      dateFrom: '2026-01-01',
      status: 'indexed',
    };

    const planOf = (candidates: SQL): Promise<string> =>
      database.db.transaction(async (tx) => {
        // The corpus is small enough for a sequential scan to win; this asks the planner
        // whether an index path exists at all.
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        const rows = await tx.execute(sql`EXPLAIN ${candidates}`);
        return rows.map((row) => String(row['QUERY PLAN'])).join('\n');
      });

    // With selective document filters the planner rightly starts from `documents` instead.
    it('serves full-text candidates from the GIN index', async () => {
      const plan = await planOf(
        fullTextCandidates({ ...request('facture'), filter: documentFilter({}, false) }),
      );
      expect(plan).toContain('Bitmap Index Scan on chunks_tsv_idx');
    });

    it.each([{}, FILTERS])(
      'serves vector candidates from the HNSW index, filters %j',
      async (filters) => {
        const [embedding] = await createFakeEmbedder().embed(['facture'], 'query');
        const plan = await planOf(vectorCandidates(embedding ?? [], request('facture', filters)));
        expect(plan).toContain('Index Scan using chunks_embedding_idx');
      },
    );
  });
});

describe('rankByVector through the HNSW index', () => {
  let database: TestDatabase;
  let indexOnly: ReturnType<typeof createDb>;
  const embedder = createFakeEmbedder();
  const RARE_STATUS = 'needs_review';

  beforeAll(async () => {
    database = await createTestDatabase();
    // Each text shares seven of its eight words with the next one: distinct distances and a
    // well-connected graph, unlike near-duplicate vectors, which HNSW may leave unreachable.
    const window = (start: number): string =>
      Array.from({ length: 8 }, (_, offset) => `word${String(start + offset)}`).join(' ');
    const texts = Array.from({ length: 150 }, (_, index) => window(index));
    const embeddings = await embedder.embed(texts, 'passage');
    for (const [index, text] of texts.entries()) {
      const { id } = await insertSyntheticDocument(database.db, {
        status: index >= 145 ? RARE_STATUS : 'indexed',
      });
      await database.db
        .insert(chunks)
        .values({ documentId: id, pageFrom: 1, pageTo: 1, text, embedding: embeddings[index] });
    }
    // A session setting, so that the ranker's own transaction plans through the index even on
    // a table this small.
    const name = new URL(database.url).pathname.slice(1);
    await database.db.execute(sql.raw(`ALTER DATABASE "${name}" SET enable_seqscan = off`));
    indexOnly = createDb(database.url);
  });

  afterAll(async () => {
    await indexOnly.close();
    await database.dispose();
  });

  const rank = (filters: SearchFilters, limit: number) =>
    rankByVector(embedder)(indexOnly.db, {
      query: 'word0 word1 word2 word3 word4 word5 word6 word7',
      filter: documentFilter(filters, true),
      limit,
    });

  it('returns as many candidates as asked, beyond the 40 of one HNSW scan', async () => {
    expect(await rank({}, 100)).toHaveLength(100);
  });

  it('keeps scanning until a selective filter is satisfied', async () => {
    expect(await rank({ status: RARE_STATUS }, 100)).toHaveLength(5);
  });
});
