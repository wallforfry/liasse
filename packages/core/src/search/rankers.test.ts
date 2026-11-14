import { eq, type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db/client.ts';
import { chunks, documents } from '../db/schema/documents.ts';
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
  type RankedChunk,
  type RankRequest,
  scanVectorIndex,
  vectorCandidates,
  type VectorIndexScan,
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

  describe('a tombstone', () => {
    it('is ranked by neither ranker', async () => {
      const id = await corpus.add(extra('tombstone', 'basalt basalt basalt'));
      expect(await fullText('basalt')).toEqual(['tombstone']);
      expect((await byVector('basalt basalt basalt'))[0]).toBe('tombstone');
      await database.db.update(documents).set({ status: 'deleted' }).where(eq(documents.id, id));
      expect(await fullText('basalt')).toEqual([]);
      expect(await byVector('basalt basalt basalt')).not.toContain('tombstone');
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

  // How far a scan gets is not a property a test can rely on: on 3000 chunks drawn at random
  // and `hnsw.max_scan_tuples = 200`, twelve builds returned between 1020 and 3000 chunks and
  // met between none and four of the five that pass the filter, and one CI run met all five.
  // The fallback is checked on what it promises instead, through scans that fall short on
  // purpose.
  describe('on a filter that leaves fewer chunks than the limit', () => {
    const CHUNKS = 3000;
    const RARE_CHUNKS = 5;
    const BATCH = 250;
    let db: Database;

    // The query lies on the first axis, so the distance of a chunk is set by the angle it
    // makes with that axis and by nothing else.
    const QUERY_VECTOR = Array.from({ length: embedder.dimension }, (_, axis) =>
      axis === 0 ? 1 : 0,
    );
    const axisEmbedder: Embedder = {
      ...embedder,
      embed: (texts) => Promise.resolve(texts.map(() => QUERY_VECTOR)),
    };

    // Mulberry32: the same sequence on every run, unlike `random()` or `Math.random()`.
    const seededRandom = (seed: number): (() => number) => {
      let state = seed;
      return () => {
        state = (state + 0x6d2b79f5) | 0;
        const mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        const again = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((again ^ (again >>> 14)) >>> 0) / 2 ** 32;
      };
    };

    // The chunks that pass the filter are the five farthest from the query, at distinct
    // angles behind 2995 others between 0.2 and 1.4 radians, so their exact order is strict.
    const angleOf = (index: number): number =>
      index <= RARE_CHUNKS ? 1.5 + index / 1000 : 0.2 + (1.2 * (index - RARE_CHUNKS)) / CHUNKS;

    const bulkVectors = (): readonly (readonly number[])[] => {
      const random = seededRandom(20_261_114);
      return Array.from({ length: CHUNKS }, (_, position) => {
        const away = Array.from({ length: embedder.dimension - 1 }, () => random() - 0.5);
        const length = Math.hypot(...away);
        const angle = angleOf(position + 1);
        return [Math.cos(angle), ...away.map((value) => (Math.sin(angle) * value) / length)];
      });
    };

    beforeAll(async () => {
      const database = await createTestDatabase();
      databases.push(database);
      await database.db.execute(sql`
        INSERT INTO documents (id, sha256, storage_key, mime, original_name, source, core)
        SELECT 'doc_bulk_' || i, 'synthetic-sha256-' || i, 'synthetic/' || i, 'application/pdf',
          'synthetic-' || i || '.pdf', 'api',
          CASE WHEN i <= ${RARE_CHUNKS} THEN ${JSON.stringify(RARE_CORE)}::jsonb ELSE '{}'::jsonb END
        FROM generate_series(1, ${CHUNKS}) AS i
      `);
      const rows = bulkVectors().map((embedding, position) => ({
        id: `chk_bulk_${String(position + 1)}`,
        documentId: `doc_bulk_${String(position + 1)}`,
        pageFrom: 1,
        pageTo: 1,
        text: 'synthetic',
        embedding: [...embedding],
      }));
      for (let start = 0; start < rows.length; start += BATCH) {
        await database.db.insert(chunks).values(rows.slice(start, start + BATCH));
      }
      const name = new URL(database.url).pathname.slice(1);
      await database.db.execute(sql.raw(`ALTER DATABASE "${name}" SET enable_seqscan = off`));
      const handle = createDb(database.url);
      handles.push(handle);
      db = handle.db;
    });

    // The order of the filtered chunks by their exact distance, read back from the table.
    const exactOrder = async (): Promise<readonly string[]> => {
      const rare = await db
        .select({ id: chunks.id, embedding: chunks.embedding })
        .from(chunks)
        .where(
          sql`${chunks.documentId} IN ('doc_bulk_1', 'doc_bulk_2', 'doc_bulk_3', 'doc_bulk_4', 'doc_bulk_5')`,
        );
      const cosine = (vector: readonly number[] | null): number =>
        (vector ?? []).reduce((sum, value, index) => sum + value * (QUERY_VECTOR[index] ?? 0), 0) /
        Math.hypot(...(vector ?? []));
      return rare
        .toSorted((left, right) => cosine(right.embedding) - cosine(left.embedding))
        .map((chunk) => chunk.id);
    };

    const rankedIds = async (scan: VectorIndexScan, limit = 100): Promise<readonly string[]> =>
      (await rankByVector(axisEmbedder, scan)(db, request(RARE, limit))).map(
        (chunk) => chunk.chunkId,
      );

    const bulkChunk = (index: number): RankedChunk => ({
      chunkId: `chk_bulk_${String(index)}`,
      documentId: `doc_bulk_${String(index)}`,
    });

    // Five chunks pass the filter and the limit is 100, so the scan comes back short on every
    // run, whatever it met: the fallback is taken whatever the random levels of the graph.
    it('returns every chunk that passes the filter, in exact order, from the real index', async () => {
      const scanned: number[] = [];
      const recorded: VectorIndexScan = async (...args) => {
        const result = await scanVectorIndex(...args);
        scanned.push(result.length);
        return result;
      };
      expect(await rankedIds(recorded)).toEqual(await exactOrder());
      expect(scanned).toHaveLength(1);
      expect(scanned[0]).toBeLessThan(100);
    });

    it('falls back when the index scan meets none of them', async () => {
      const ids = await rankedIds(() => Promise.resolve([]));
      expect(ids).toEqual(await exactOrder());
      expect(ids).toHaveLength(RARE_CHUNKS);
    });

    it('falls back when the index scan meets some of them, out of order', async () => {
      const ids = await rankedIds(() => Promise.resolve([bulkChunk(4), bulkChunk(2)]));
      expect(ids).toEqual(await exactOrder());
    });

    it('keeps a scan that filled the limit', async () => {
      const filled = [bulkChunk(5), bulkChunk(3)];
      expect(await rankedIds(() => Promise.resolve(filled), 2)).toEqual([
        'chk_bulk_5',
        'chk_bulk_3',
      ]);
    });
  });
});
