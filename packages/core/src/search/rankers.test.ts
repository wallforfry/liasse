import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db/client.ts';
import { chunks } from '../db/schema/documents.ts';
import type { Embedder, EmbeddingKind } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { CORPUS, type CorpusDocument, seedCorpus, type SeededCorpus } from './corpus.fixture.ts';
import { documentFilter } from './filters.ts';
import type { SearchFilters } from './input.ts';
import { parseSearchQuery } from './tsquery.ts';
import {
  fullTextCandidates,
  rankByFullText,
  rankByVector,
  type RankRequest,
  scanVectorIndex,
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

  const request = async (
    query: string,
    filters: SearchFilters = {},
    limit = 100,
  ): Promise<RankRequest> => ({
    query,
    tsquery: (await parseSearchQuery(database.db, query)) ?? '',
    filter: documentFilter(filters, true),
    limit,
  });

  const fullText = async (query: string, filters?: SearchFilters, limit?: number) =>
    (await rankByFullText(database.db, await request(query, filters, limit))).map((chunk) =>
      corpus.keyOf(chunk.documentId),
    );

  const byVector = async (query: string, filters?: SearchFilters, limit?: number) =>
    (
      await rankByVector(createFakeEmbedder())(database.db, await request(query, filters, limit))
    ).map((chunk) => corpus.keyOf(chunk.documentId));

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
      await rankByVector(embedder)(database.db, await request('salary'));
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
      await expect(rankByVector(embedder)(database.db, await request('salary'))).rejects.toThrow(
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
        fullTextCandidates({ ...(await request('facture')), filter: documentFilter({}, false) }),
      );
      expect(plan).toContain('Bitmap Index Scan on chunks_tsv_idx');
    });

    it.each([{}, FILTERS])(
      'serves vector candidates from the HNSW index, filters %j',
      async (filters) => {
        const [embedding] = await createFakeEmbedder().embed(['facture'], 'query');
        const plan = await planOf(
          vectorCandidates(embedding ?? [], await request('facture', filters)),
        );
        expect(plan).toContain('Index Scan using chunks_embedding_idx');
      },
    );
  });
});

describe('the vector ranker on an HNSW index', () => {
  const embedder = createFakeEmbedder();
  // A filter on a JSON field: the planner cannot estimate it, nor serve it from an index, so it
  // keeps the HNSW scan and applies the filter to what the scan returns.
  const RARE = { dateFrom: '2030-01-01' } as const;
  const RARE_CORE = { document_date: '2030-06-15' };
  const QUERY = 'word0 word1 word2 word3 word4 word5 word6 word7';
  const databases: TestDatabase[] = [];
  const handles: ReturnType<typeof createDb>[] = [];

  // 150 chunks, the last five of which are the farthest from the query and the only ones that
  // pass the filter. The returned handle plans through the index, even on a table this small.
  const indexOnlyDatabase = async (settings: readonly string[] = []) => {
    const database = await createTestDatabase();
    databases.push(database);
    // Each text shares seven of its eight words with the next one: distinct distances and a
    // well-connected graph, unlike near-duplicate vectors, which HNSW may leave unreachable.
    const window = (start: number): string =>
      Array.from({ length: 8 }, (_, offset) => `word${String(start + offset)}`).join(' ');
    const texts = Array.from({ length: 150 }, (_, index) => window(index));
    const embeddings = await embedder.embed(texts, 'passage');
    for (const [index, text] of texts.entries()) {
      const { id } = await insertSyntheticDocument(database.db, {
        core: index >= 145 ? RARE_CORE : {},
      });
      await database.db
        .insert(chunks)
        .values({ documentId: id, pageFrom: 1, pageTo: 1, text, embedding: embeddings[index] });
    }
    const name = new URL(database.url).pathname.slice(1);
    for (const setting of ['enable_seqscan = off', ...settings]) {
      await database.db.execute(sql.raw(`ALTER DATABASE "${name}" SET ${setting}`));
    }
    const handle = createDb(database.url);
    handles.push(handle);
    return handle.db;
  };

  afterAll(async () => {
    await Promise.all(handles.map((handle) => handle.close()));
    await Promise.all(databases.map((database) => database.dispose()));
  });

  const request = (filters: SearchFilters, limit: number): RankRequest => ({
    query: QUERY,
    tsquery: '',
    filter: documentFilter(filters, true),
    limit,
  });

  const scan = async (db: Database, filters: SearchFilters, limit: number) => {
    const [embedding = []] = await embedder.embed([QUERY], 'query');
    return scanVectorIndex(db, embedding, request(filters, limit));
  };

  describe('within the tuples one scan may visit', () => {
    let db: Database;

    beforeAll(async () => {
      db = await indexOnlyDatabase();
    });

    it('scans beyond the 40 candidates of a single pass', async () => {
      expect(await scan(db, {}, 100)).toHaveLength(100);
    });

    it('keeps scanning until a selective filter is satisfied', async () => {
      expect(await scan(db, RARE, 100)).toHaveLength(5);
    });
  });

  describe('beyond the tuples one scan may visit', () => {
    const CHUNKS = 3000;
    let db: Database;

    // Random vectors, five of which belong to the documents that pass the filter: a scan that stops
    // early has no reason to have met them.
    beforeAll(async () => {
      const database = await createTestDatabase();
      databases.push(database);
      await database.db.execute(sql`
        INSERT INTO documents (id, sha256, storage_key, mime, original_name, source, core)
        SELECT 'doc_bulk_' || i, 'synthetic-sha256-' || i, 'synthetic/' || i, 'application/pdf',
          'synthetic-' || i || '.pdf', 'api',
          CASE WHEN i <= 5 THEN ${JSON.stringify(RARE_CORE)}::jsonb ELSE '{}'::jsonb END
        FROM generate_series(1, ${CHUNKS}) AS i
      `);
      await database.db.execute(sql`
        INSERT INTO chunks (id, document_id, page_from, page_to, text, embedding)
        SELECT 'chk_bulk_' || i, 'doc_bulk_' || i, 1, 1, 'synthetic',
          (SELECT array_agg(random() - 0.5) FROM generate_series(1, 384) AS axis WHERE axis + i > 0)::vector
        FROM generate_series(1, ${CHUNKS}) AS i
      `);
      const name = new URL(database.url).pathname.slice(1);
      for (const setting of ['enable_seqscan = off', 'hnsw.max_scan_tuples = 200']) {
        await database.db.execute(sql.raw(`ALTER DATABASE "${name}" SET ${setting}`));
      }
      const handle = createDb(database.url);
      handles.push(handle);
      db = handle.db;
    });

    it('the index scan alone misses chunks that pass the filter', async () => {
      expect((await scan(db, RARE, 100)).length).toBeLessThan(5);
    });

    it('falls back to an exact ordering of the filtered chunks', async () => {
      const ranked = await rankByVector(embedder)(db, request(RARE, 100));
      const [query = []] = await embedder.embed([QUERY], 'query');
      const rare = await db
        .select({ id: chunks.id, embedding: chunks.embedding })
        .from(chunks)
        .where(
          sql`${chunks.documentId} IN ('doc_bulk_1', 'doc_bulk_2', 'doc_bulk_3', 'doc_bulk_4', 'doc_bulk_5')`,
        );
      const cosine = (vector: readonly number[] | null): number =>
        (vector ?? []).reduce((sum, value, index) => sum + value * (query[index] ?? 0), 0) /
        Math.hypot(...(vector ?? []));
      expect(ranked.map((chunk) => chunk.chunkId)).toEqual(
        rare
          .toSorted((left, right) => cosine(right.embedding) - cosine(left.embedding))
          .map((chunk) => chunk.id),
      );
    });
  });
});
