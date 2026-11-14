import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createDb } from '../db/client.ts';
import { seedEntity, SYNTHETIC_IBAN } from '../entities/support.test-helper.ts';
import { deleteFileJob } from '../ingest/delete-file-job.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { CORPUS } from '../search/corpus.fixture.ts';
import { describeTypes } from './describe-types.ts';
import { ApiError } from './errors.ts';
import { applyChange, correctDocument, listChanges, listSubjects, upcoming } from './features.ts';
import { type ApiHarness, createApiHarness } from './harness.test-helper.ts';
import { listEntities } from './list-entities.ts';
import { queryDocuments } from './query-documents.ts';
import { searchDocuments } from './search-documents.ts';
import { readStats } from './stats.ts';

const failureOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

const NOT_IMPLEMENTED = { kind: 'not_implemented', code: 'not_implemented' };

describe('use cases of the API', () => {
  let harness: ApiHarness;

  beforeAll(async () => {
    harness = await createApiHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  describe('searchDocuments', () => {
    const titles = async (request: Parameters<typeof searchDocuments>[1]) =>
      (await searchDocuments(harness.context, request)).results.map((hit) => hit.title);

    it('returns hits with snippets under the names of the specification', async () => {
      const { results } = await searchDocuments(harness.context, { query: 'payslip', limit: 1 });
      expect(results).toHaveLength(1);
      expect(Object.keys(results[0] ?? {}).toSorted()).toEqual([
        'core',
        'id',
        'score',
        'snippets',
        'title',
        'type',
      ]);
      expect(Object.keys(results[0]?.snippets[0] ?? {}).toSorted()).toEqual([
        'highlights',
        'page_from',
        'page_to',
        'text',
      ]);
    });

    it('leaves private documents out unless include_private is true', async () => {
      const privateTitles = CORPUS.filter((document) => document.private === true).map(
        (document) => document.title,
      );
      const request = { query: 'taxe foncière', filters: { type: 'property_tax_notice' } };
      const byDefault = await titles(request);
      expect(byDefault).not.toEqual([]);
      expect(byDefault.filter((title) => privateTitles.includes(title ?? ''))).toEqual([]);
      expect(await titles({ ...request, include_private: false })).toEqual(byDefault);
      const asked = await titles({ ...request, include_private: true });
      expect(asked.filter((title) => privateTitles.includes(title ?? ''))).not.toEqual([]);
    });

    it('filters by date under snake_case names and refuses any other key', async () => {
      const dated = CORPUS.filter((document) => document.type === 'payslip');
      const first = dated.map((document) => document.date ?? '').toSorted()[0] ?? '';
      const hits = await titles({
        query: 'payslip',
        filters: { date_from: first, date_to: first },
      });
      expect(hits).toEqual(
        dated.filter((document) => document.date === first).map((document) => document.title),
      );
      await expect(
        searchDocuments(
          harness.context,
          Object.assign({ query: 'payslip' }, { includePrivate: true }),
        ),
      ).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('queryDocuments', () => {
    it('answers with the rows of the DSL', async () => {
      const result = await queryDocuments(harness.context, { type: 'payslip', limit: 2 });
      expect(result).toMatchObject({ has_more: true, warnings: [] });
      expect('rows' in result ? result.rows.map((row) => row.type) : []).toEqual([
        'payslip',
        'payslip',
      ]);
    });

    it('refuses a query with the errors of the DSL, data fields included', async () => {
      const failure = await failureOf(
        queryDocuments(harness.context, { where: [['core.isuer', '=', 'Volta']] }),
      );
      expect(failure).toMatchObject({ kind: 'invalid', code: 'invalid_query' });
      expect(failure.details.errors).toMatchObject([
        {
          code: 'unknown_field',
          field: 'core.isuer',
          suggestion: 'core.issuer',
          path: ['where', 0, 0],
        },
      ]);
      expect(failure.details.errors).toHaveProperty('0.available');
    });

    it('reports a statement stopped by its timeout as a timeout', async () => {
      const failure = await harness.database.db.transaction(async (tx) => {
        await tx.execute(sql`LOCK TABLE documents IN ACCESS EXCLUSIVE MODE`);
        return failureOf(queryDocuments({ ...harness.context, queryTimeoutMs: 150 }, {}));
      });
      expect(failure).toMatchObject({ kind: 'timeout', code: 'query_timeout', details: {} });
    });

    it('says nothing of the statement when the database fails', async () => {
      const unreachable = createDb('postgres://liasse:liasse@127.0.0.1:1/liasse');
      try {
        const failure = await failureOf(
          queryDocuments({ ...harness.context, db: unreachable.db }, { type: 'payslip' }),
        );
        expect(failure).toMatchObject({ kind: 'unavailable', code: 'query_failed', details: {} });
        expect(failure.message).toBe('The query could not be run.');
        expect(failure.cause).toBeUndefined();
      } finally {
        await unreachable.close();
      }
    });
  });

  describe('describeTypes', () => {
    it('lists the types that are not merged, with their document count', async () => {
      const { types } = await describeTypes(harness.context);
      expect(types.map((type) => type.slug)).not.toContain('legacy_power_bill');
      const payslips = CORPUS.filter((document) => document.type === 'payslip').length;
      expect(types.find((type) => type.slug === 'payslip')).toEqual({
        slug: 'payslip',
        description: 'Monthly payslip',
        parent_slug: null,
        version: 1,
        status: 'provisional',
        aliases: [],
        fields: {},
        document_count: payslips,
      });
    });

    it('filters by status and adds example titles when asked', async () => {
      const merged = await describeTypes(harness.context, {
        status: 'merged',
        include_examples: true,
      });
      expect(merged.types.map((type) => type.slug)).toEqual(['legacy_power_bill']);
      expect(merged.types[0]?.examples).toBeInstanceOf(Array);
    });
  });

  describe('listEntities', () => {
    it('lists entities under snake_case names, with sensitive identifiers masked', async () => {
      await seedEntity(harness.database.db, {
        name: 'Banque Synthétique',
        aliases: ['Synthetic Bank'],
        identifiers: [{ type: 'iban', value: SYNTHETIC_IBAN }],
      });
      const list = await listEntities(harness.context, { query: 'synth', kind: 'org' });
      expect(list.total).toBe(1);
      expect(list.entities[0]).toMatchObject({
        kind: 'org',
        canonical_name: 'Banque Synthétique',
        aliases: ['Synthetic Bank'],
        document_count: 0,
      });
      expect(JSON.stringify(list)).not.toContain(SYNTHETIC_IBAN);
      expect(JSON.stringify(list)).not.toContain('hash');
    });
  });

  describe('features that are not bound', () => {
    it('answer not_implemented', async () => {
      const { context } = harness;
      const calls = [
        correctDocument(context, 'doc_01JC0000000000000000000000', { private: true }),
        listSubjects(context, {}),
        upcoming(context, { from: '2026-01-01', to: '2026-03-31', current_only: true }),
        listChanges(context, {}),
        applyChange(context, 'chg_01JC0000000000000000000000', { decision: 'apply' }),
      ];
      for (const call of calls) expect(await failureOf(call)).toMatchObject(NOT_IMPLEMENTED);
    });
  });

  describe('features that are bound', () => {
    it('hands a correction over with the id, and maps what it refuses', async () => {
      const received: unknown[] = [];
      const refusing = harness.withFeatures({
        correctDocument: (input) => {
          received.push(input);
          return Promise.resolve({
            ok: false,
            errors: [
              { code: 'unknown_field', message: 'No field "colour".', internal: 'kept out' },
            ],
          });
        },
      });
      const failure = await failureOf(correctDocument(refusing, 'doc_1', { private: true }));
      expect(received).toEqual([{ id: 'doc_1', private: true }]);
      expect(failure).toMatchObject({
        kind: 'invalid',
        code: 'invalid_correction',
        details: { errors: [{ code: 'unknown_field', message: 'No field "colour".' }] },
      });
      expect(JSON.stringify(failure.details)).not.toContain('kept out');
    });

    it('does not find a document the correction does not find', async () => {
      const missing = harness.withFeatures({
        correctDocument: () =>
          Promise.resolve({ ok: false, errors: [{ code: 'document_not_found', message: 'none' }] }),
      });
      expect(await failureOf(correctDocument(missing, 'doc_1', {}))).toMatchObject({
        kind: 'not_found',
        code: 'document_not_found',
      });
      const accepting = harness.withFeatures({
        correctDocument: () => Promise.resolve({ ok: true }),
      });
      await expect(correctDocument(accepting, 'doc_1', {})).resolves.toBeUndefined();
    });

    it('does not find a change the feature does not know', async () => {
      const context = harness.withFeatures({
        applyChange: (id) => Promise.resolve(id === 'chg_known' ? { applied: true } : undefined),
      });
      expect(await applyChange(context, 'chg_known', { decision: 'apply' })).toEqual({
        applied: true,
      });
      expect(
        await failureOf(applyChange(context, 'chg_other', { decision: 'reject' })),
      ).toMatchObject({ kind: 'not_found', code: 'change_not_found' });
    });
  });

  describe('readStats', () => {
    it('counts live documents by status and jobs by kind and status', async () => {
      const { db } = harness.database;
      const before = await readStats(harness.context);
      expect(before.documents.toSorted((a, b) => a.status.localeCompare(b.status))).toEqual([
        { status: 'indexed', count: CORPUS.length - 2 },
        { status: 'needs_review', count: 2 },
      ]);
      expect(before).toMatchObject({ jobs: [], queueDepth: 0, oldestQueuedAgeSeconds: 0 });

      await enqueue(db, { kind: deleteFileJob, payload: { documentId: 'doc_a' } });
      await enqueue(db, { kind: deleteFileJob, payload: { documentId: 'doc_b' } });
      await db.execute(sql`UPDATE jobs SET run_after = now() - interval '90 seconds'`);
      await enqueue(db, {
        kind: deleteFileJob,
        payload: { documentId: 'doc_c' },
        runAfter: new Date(Date.now() + 3_600_000),
      });
      const after = await readStats(harness.context);
      expect(after.jobs).toEqual([{ kind: 'delete_file', status: 'queued', count: 3 }]);
      expect(after.queueDepth).toBe(2);
      expect(after.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(90);
      await db.execute(sql`DELETE FROM jobs`);
    });

    it('does not count tombstones', async () => {
      const { db } = harness.database;
      await db.execute(
        sql`UPDATE documents SET status = 'deleted' WHERE id = ${harness.corpus.idOf('payslip-01')}`,
      );
      const { documents } = await readStats(harness.context);
      expect(documents.map(({ status }) => status)).not.toContain('deleted');
      expect(documents.find(({ status }) => status === 'indexed')?.count).toBe(CORPUS.length - 3);
    });
  });
});
