import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { chunks, documents } from '../db/schema/documents.ts';
import type { Embedder } from '../models/ports.ts';
import { createFakeEmbedder } from '../testing/fake-embedder.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import {
  CORPUS,
  type CorpusDocument,
  ENTITIES,
  seedCorpus,
  type SeededCorpus,
  SUBJECTS,
} from './corpus.fixture.ts';
import { type SearchFilters, type SearchInput, searchInputSchema } from './input.ts';
import type { RankRequest } from './rankers.ts';
import { search, type SearchDeps, type SearchHit } from './search.ts';
import { MAX_SNIPPET_LENGTH, type Snippet } from './snippets.ts';

const keysOfType = (...types: readonly string[]): readonly string[] =>
  CORPUS.filter((document) => types.includes(document.type))
    .map((document) => document.key)
    .toSorted();

const ENERGY_BILLS = keysOfType('energy_bill', 'legacy_power_bill');

const extra = (
  key: string,
  pages: readonly string[],
  overrides: Partial<CorpusDocument> = {},
): CorpusDocument => ({ key, title: key, type: 'warranty', language: null, pages, ...overrides });

const remoteEmbedder = createFakeEmbedder({ isLocal: false });

const highlighted = (snippet: Snippet | undefined): readonly string[] =>
  snippet?.highlights.map(({ start, end }) => snippet.text.slice(start, end)) ?? [];

describe('search', () => {
  let database: TestDatabase;
  let corpus: SeededCorpus;
  let deps: SearchDeps;

  beforeAll(async () => {
    database = await createTestDatabase();
    const embedder = createFakeEmbedder();
    corpus = await seedCorpus(database.db, embedder);
    deps = { db: database.db, embedder };
  });

  afterAll(async () => {
    await database.dispose();
  });

  const keys = (hits: readonly SearchHit[]): readonly string[] =>
    hits.map((hit) => corpus.keyOf(hit.id));

  const find = (query: string, input: Omit<SearchInput, 'query'> = {}) =>
    search(deps, { query, ...input });

  const filtered = async (filters: SearchFilters, query = 'facture'): Promise<readonly string[]> =>
    keys(await find(query, { filters, limit: 50 })).toSorted();

  it('runs on a corpus of more than fifty indexed documents', async () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(50);
    const [indexed] = await database.db
      .select({ documents: count(documents.id), chunks: count(chunks.id) })
      .from(documents)
      .leftJoin(chunks, eq(chunks.documentId, documents.id));
    expect(indexed).toEqual({ documents: CORPUS.length, chunks: CORPUS.length });
  });

  it.each([
    ['an exact term', 'Brisa', 'warranty-02'],
    ['exact terms', 'facture septembre', 'energy-09'],
    ['a query without its accents', 'electricite fevrier', 'energy-02'],
    ['an accented query', 'Électricité Août', 'energy-08'],
    ['another form of a French word', 'factures septembre', 'energy-09'],
    ['another form of an English word', 'payslips march', 'payslip-03'],
  ])('finds a document by %s, agreed on by both rankers', async (_, query, expected) => {
    const [first, second] = await find(query);
    expect(first && corpus.keyOf(first.id)).toBe(expected);
    expect(first?.score).toBeCloseTo(2 / 61, 12);
    expect(second?.score).toBeLessThan(2 / 61);
  });

  it('finds a document by meaning when its words do not all match', async () => {
    const [first] = await find('Northwind salary bonus March');
    expect(first && corpus.keyOf(first.id)).toBe('payslip-03');
    expect(first?.score).toBeCloseTo(1 / 61, 12);
  });

  it('finds by full text a document whose chunks have no embedding', async () => {
    const subjects = ['sub_synthetic_unembedded'];
    await corpus.add(
      extra('unembedded', ['quasar nebula'], { subjects, private: true }),
      remoteEmbedder,
    );
    const hits = await find('quasar', {
      filters: { subject: 'sub_synthetic_unembedded' },
      includePrivate: true,
    });
    expect(keys(hits)).toEqual(['unembedded']);
    expect(hits[0]?.score).toBeCloseTo(1 / 61, 12);
  });

  describe('filters', () => {
    it.each<[string, SearchFilters, readonly string[]]>([
      ['a type slug', { type: 'payslip' }, keysOfType('payslip')],
      ['a type and the types merged into it', { type: 'energy_bill' }, ENERGY_BILLS],
      ['a type alias', { type: 'electricity_bill' }, ENERGY_BILLS],
      ['the slug of a merged type', { type: 'legacy_power_bill' }, ENERGY_BILLS],
      ['an unknown type', { type: 'unknown_type' }, []],
      ['an issuer', { entity: ENTITIES.volta }, ENERGY_BILLS],
      [
        'a recipient',
        { entity: ENTITIES.resident },
        keysOfType('energy_bill', 'legacy_power_bill', 'payslip', 'rent_receipt'),
      ],
      ['a subject', { subject: SUBJECTS.car }, ['insurance-07', 'insurance-08']],
      [
        'a start date',
        { dateFrom: '2026-11-01' },
        ['energy-11', 'energy-12', 'payslip-11', 'payslip-12'],
      ],
      ['an end date', { dateTo: '2022-12-31' }, ['tax-2022']],
      [
        'a date range, bounds included',
        { dateFrom: '2025-03-12', dateTo: '2025-04-12' },
        ['insurance-03', 'insurance-04'],
      ],
      ['a status', { status: 'needs_review' }, ['warranty-01', 'warranty-02']],
      [
        'several filters at once',
        {
          type: 'payslip',
          entity: ENTITIES.northwind,
          dateFrom: '2026-06-01',
          dateTo: '2026-08-31',
        },
        ['payslip-06', 'payslip-07', 'payslip-08'],
      ],
      ['filters that exclude each other', { type: 'payslip', entity: ENTITIES.volta }, []],
    ])('keeps only the documents of %s', async (_, filters, expected) => {
      expect(await filtered(filters)).toEqual(expected);
      expect(await filtered(filters, 'salary employer')).toEqual(expected);
    });

    it('narrows the candidates instead of filtering an already limited list', async () => {
      const hits = await search(
        { ...deps, candidatesPerRanker: 2 },
        { query: 'salary', filters: { type: 'warranty' } },
      );
      expect(hits).toHaveLength(2);
      expect(hits.map((hit) => hit.type)).toEqual(['warranty', 'warranty']);
    });

    it('rejects a filter it does not know', async () => {
      expect(
        searchInputSchema.safeParse({ query: 'facture', filters: { author: 'someone' } }).success,
      ).toBe(false);
      await expect(find('facture', { filters: { dateFrom: '01/11/2026' } })).rejects.toBeInstanceOf(
        ZodError,
      );
    });
  });

  describe('private documents', () => {
    const TAX_NOTICES = { type: 'property_tax_notice' };

    it('leaves them out by default', async () => {
      expect(keys(await find('taxe foncière', { filters: TAX_NOTICES })).toSorted()).toEqual([
        'tax-2022',
        'tax-2023',
      ]);
    });

    it('returns them on request', async () => {
      const hits = await find('taxe foncière', { filters: TAX_NOTICES, includePrivate: true });
      expect(keys(hits).toSorted()).toEqual(['tax-2022', 'tax-2023', 'tax-2024', 'tax-2025']);
    });
  });

  describe('fusion', () => {
    const SUBJECT = 'sub_synthetic_fusion';

    it('adds 1 / (60 + rank) per ranker, as computed by hand', async () => {
      await corpus.add(extra('fusion-x', ['alpha beta'], { subjects: [SUBJECT] }));
      await corpus.add(extra('fusion-y', ['alpha gamma delta'], { subjects: [SUBJECT] }));
      await corpus.add(extra('fusion-z', ['omega'], { subjects: [SUBJECT] }));
      // Full text needs both words: [x]. By vector: x shares two words, y one, z none.
      const hits = await find('alpha beta', { filters: { subject: SUBJECT } });
      expect(keys(hits)).toEqual(['fusion-x', 'fusion-y', 'fusion-z']);
      expect(hits[0]?.score).toBeCloseTo(1 / 61 + 1 / 61, 12);
      expect(hits[1]?.score).toBeCloseTo(1 / 62, 12);
      expect(hits[2]?.score).toBeCloseTo(1 / 63, 12);
    });

    it('breaks a tie between two documents by id', async () => {
      const subjects = ['sub_synthetic_tie'];
      const byVectorOnly = await corpus.add(extra('tie-vector', ['unrelated words'], { subjects }));
      const byTextOnly = await corpus.add(
        extra('tie-text', ['sigma'], { subjects, private: true }),
        remoteEmbedder,
      );
      expect(byVectorOnly < byTextOnly).toBe(true);
      const input = { filters: { subject: 'sub_synthetic_tie' }, includePrivate: true };
      const hits = await find('sigma', input);
      expect(hits.map((hit) => hit.score)).toEqual([1 / 61, 1 / 61]);
      expect(keys(hits)).toEqual(['tie-vector', 'tie-text']);
      expect(await find('sigma', input)).toEqual(hits);
    });

    it('parses the query once and hands the result to the rankers', async () => {
      const requests: RankRequest[] = [];
      await search(
        {
          ...deps,
          fullText: (_, request) => {
            requests.push(request);
            return Promise.resolve([]);
          },
        },
        { query: 'factures impayées' },
      );
      expect(requests.map((request) => request.query)).toEqual(['factures impayées']);
      expect(requests[0]?.tsquery).toContain("'factur' & 'impaye'");
      expect(requests[0]?.tsquery).toContain("'factures' & 'impayees'");
    });

    it('goes through the full-text ranker it is given', async () => {
      const [first] = await search(
        { ...deps, fullText: () => Promise.resolve([]) },
        { query: 'Brisa' },
      );
      expect(first && corpus.keyOf(first.id)).toBe('warranty-02');
      expect(first?.score).toBeCloseTo(1 / 61, 12);
    });
  });

  describe('grouping and snippets', () => {
    it('returns a document once, with its three best chunks at most', async () => {
      const pages = Array.from(
        { length: 5 },
        (_, index) => `Section ${String(index + 1)} of the zephyr maintenance manual.`,
      );
      await corpus.add(extra('manual', pages));
      const hits = await find('zephyr maintenance manual');
      expect(keys(hits).filter((key) => key === 'manual')).toEqual(['manual']);
      const [manual] = hits;
      expect(manual && corpus.keyOf(manual.id)).toBe('manual');
      expect(manual?.snippets).toHaveLength(3);
      expect(new Set(manual?.snippets.map((snippet) => snippet.pageFrom)).size).toBe(3);
      expect(manual?.score).toBeCloseTo(2 / 61, 12);
    });

    it('gives one snippet to a document with one matching chunk', async () => {
      const [first] = await find('Brisa');
      expect(first?.snippets).toEqual([
        {
          text: 'Warranty certificate reference ZX4101. Appliance model Brisa, covered for 24 months from the purchase',
          highlights: [{ start: 55, end: 60 }],
          pageFrom: 1,
          pageTo: 1,
        },
      ]);
    });

    it('highlights the words of the query in the original, accented text', async () => {
      const [first] = await find('electricite septembre');
      const [snippet] = first?.snippets ?? [];
      expect(snippet?.text).toContain('Facture d’électricité de septembre 2026');
      expect(highlighted(snippet)).toEqual(['électricité', 'septembre']);
    });

    it('bounds the length of a snippet', async () => {
      const filler = 'Routine paragraph about nothing in particular. '.repeat(30);
      await corpus.add(extra('long-page', [`${filler}The zenith clause applies. ${filler}`]));
      const [first] = await find('zenith clause');
      const [snippet] = first?.snippets ?? [];
      expect(first && corpus.keyOf(first.id)).toBe('long-page');
      expect(snippet?.text).toContain('The zenith clause applies.');
      expect(highlighted(snippet)).toEqual(['zenith', 'clause']);
      expect(snippet?.text.length).toBeLessThan(400);

      const longWords = Array.from(
        { length: 20 },
        (_, index) => `${'x'.repeat(95)}${String(index)}`,
      );
      await corpus.add(
        extra('long-words', [`${longWords.join(' ')} zenithword ${longWords.join(' ')}`]),
      );
      const [wordy] = await find('zenithword');
      expect(wordy && corpus.keyOf(wordy.id)).toBe('long-words');
      const [cut] = wordy?.snippets ?? [];
      expect(cut?.text).toHaveLength(MAX_SNIPPET_LENGTH);
      expect(
        cut?.highlights.every(({ start, end }) => start < end && end <= MAX_SNIPPET_LENGTH),
      ).toBe(true);
    });

    it('returns the words of the document as they are and highlights by offsets, not by marks', async () => {
      await corpus.add(
        extra('marked', ['Notice: **bold** \u{E000}zenithmark\u{E001} & 5 > 3 ends.']),
      );
      const [first] = await find('zenithmark');
      const [snippet] = first?.snippets ?? [];
      expect(first && corpus.keyOf(first.id)).toBe('marked');
      expect(snippet?.text).toBe('Notice: **bold** zenithmark & 5 > 3 ends');
      expect(highlighted(snippet)).toEqual(['zenithmark']);
    });
  });

  describe('output', () => {
    it('describes a hit by its id, title, type slug, core, snippets and score', async () => {
      const [first] = await find('facture septembre');
      expect(first).toEqual({
        id: corpus.idOf('energy-09'),
        title: 'Facture d’électricité septembre 2026',
        type: 'energy_bill',
        core: {
          language: 'fr',
          document_date: '2026-09-05',
          issuer: 'Volta Énergie',
          recipient: 'Camille Tisserand',
        },
        snippets: [
          {
            text: first?.snippets[0]?.text,
            highlights: first?.snippets[0]?.highlights,
            pageFrom: 1,
            pageTo: 1,
          },
        ],
        score: first?.score,
      });
      expect(highlighted(first?.snippets[0])).toEqual(['Facture', 'septembre']);
      expect(first?.score).toBeGreaterThan(0);
    });

    it('names the type a document is attached to, even a merged one', async () => {
      const [first] = await find('facture novembre');
      expect(first).toMatchObject({ id: corpus.idOf('energy-11'), type: 'legacy_power_bill' });
    });

    it('returns ten documents by default and `limit` documents on request', async () => {
      const byDefault = await find('facture');
      expect(byDefault).toHaveLength(10);
      expect(await find('facture', { limit: 3 })).toEqual(byDefault.slice(0, 3));
      expect(await find('facture', { limit: 50 })).toHaveLength(50);
    });

    it('orders hits by decreasing score', async () => {
      const scores = (await find('facture', { limit: 50 })).map((hit) => hit.score);
      expect(scores).toEqual(scores.toSorted((left, right) => right - left));
    });

    it.each([0, 51, 1.5])('rejects the limit %s', async (limit) => {
      await expect(find('facture', { limit })).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('queries', () => {
    it.each(['"unbalanced ((( & | !', "'; DROP TABLE chunks; --", 'fac\u0000ture', 'le la les'])(
      'does not raise on %j',
      async (query) => {
        expect(await find(query)).toBeInstanceOf(Array);
      },
    );

    it('returns nothing for a blank query, without calling the embedder', async () => {
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        embed: () => Promise.reject(new Error('the embedder must not be called')),
      };
      expect(await search({ db: database.db, embedder }, { query: ' \n\u0000 ' })).toEqual([]);
    });

    it('returns nothing from an index without chunks, without calling the embedder', async () => {
      const empty = await createTestDatabase();
      try {
        const embedder: Embedder = {
          ...createFakeEmbedder(),
          embed: () => Promise.reject(new Error('the embedder must not be called')),
        };
        expect(await search({ db: empty.db, embedder }, { query: 'facture' })).toEqual([]);
      } finally {
        await empty.dispose();
      }
    });

    it('fails when the query cannot be embedded', async () => {
      const embedder: Embedder = {
        ...createFakeEmbedder(),
        embed: () => Promise.reject(new Error('synthetic embedder outage')),
      };
      await expect(search({ db: database.db, embedder }, { query: 'facture' })).rejects.toThrow(
        'synthetic embedder outage',
      );
    });
  });
});
