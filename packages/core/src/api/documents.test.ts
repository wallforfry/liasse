import { buffer } from 'node:stream/consumers';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentEvents } from '../db/schema/document-events.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { detectLinksJob } from '../knowledge/jobs.ts';
import { reclassifyDocumentJob } from '../pipeline/jobs.ts';
import { type DocumentEventInput, recordDocumentEvent } from '../processing-log/record.ts';
import { CORPUS, ENTITIES } from '../search/corpus.fixture.ts';
import { parseStorageKey } from '../storage/key.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { listDocumentEvents } from './document-events.ts';
import { openDocumentFile, removeDocument } from './document-file.ts';
import { ApiError } from './errors.ts';
import { getDocument } from './get-document.ts';
import { type ApiHarness, createApiHarness, TEST_MAX_FILE_SIZE } from './harness.test-helper.ts';
import { listDocuments } from './list-documents.ts';
import { uploadDocument } from './upload-document.ts';

const failureOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

const PUBLIC = CORPUS.filter((document) => document.private !== true);
const PRIVATE = CORPUS.filter((document) => document.private === true);

describe('documents of the API', () => {
  let harness: ApiHarness;

  beforeAll(async () => {
    harness = await createApiHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const upload = (label: string, options: { readonly private?: boolean } = {}) =>
    uploadDocument(harness.context, {
      bytes: syntheticPdf(label),
      filename: `${label}.pdf`,
      source: 'api',
      ...options,
    });

  describe('uploadDocument', () => {
    it('answers with the id, the status and whether the bytes were already known', async () => {
      const first = await upload('upload once');
      expect(first).toEqual({ id: first.id, status: 'received', duplicate: false });
      expect(await upload('upload once')).toEqual({ ...first, duplicate: true });
    });

    it('flags the document private when asked', async () => {
      const { id } = await upload('upload private', { private: true });
      expect((await getDocument(harness.context, id)).private).toBe(true);
    });

    it('refuses a file over the limit with the limit in the details', async () => {
      const failure = await failureOf(
        uploadDocument(harness.context, {
          bytes: new Uint8Array(TEST_MAX_FILE_SIZE + 1),
          filename: 'large.pdf',
          source: 'api',
        }),
      );
      expect(failure).toMatchObject({
        kind: 'too_large',
        code: 'file_too_large',
        details: { max_file_size: TEST_MAX_FILE_SIZE },
      });
    });

    it.each([
      [new TextEncoder().encode('plain text, not a document'), 'unsupported', 'unsupported_format'],
      [new Uint8Array(), 'invalid', 'empty_file'],
    ] as const)('refuses what ingestion refuses (%#)', async (bytes, kind, code) => {
      const failure = await failureOf(
        uploadDocument(harness.context, { bytes, filename: 'note.txt', source: 'mcp' }),
      );
      expect(failure).toMatchObject({ kind, code });
    });
  });

  describe('getDocument', () => {
    it('returns the document without any part, and never where its file is stored', async () => {
      const id = harness.corpus.idOf('payslip-01');
      const document = await getDocument(harness.context, id);
      expect(document).toMatchObject({
        id,
        status: 'indexed',
        type: 'payslip',
        private: false,
        source: 'api',
      });
      const parts = [
        'fields',
        'extra',
        'manual_fields',
        'provenance',
        'text',
        'pages',
        'file_url',
        'review',
      ];
      expect(parts.filter((part) => Object.hasOwn(document, part))).toEqual([]);
      const [row] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
      const serialised = JSON.stringify(
        await getDocument(harness.context, id, {
          include: ['fields', 'text', 'pages', 'file_url', 'provenance'],
        }),
      );
      expect(serialised).not.toContain(row?.storageKey);
      expect(serialised).not.toContain(row?.sha256);
    });

    it('says whether a job that rewrites its type or values is queued or running', async () => {
      const { db } = harness.database;
      const { id } = await insertSyntheticDocument(db, { status: 'needs_review', private: true });
      const pending = async () => (await getDocument(harness.context, id)).analysis_pending;
      expect(await pending()).toBe(false);
      await enqueue(db, { kind: detectLinksJob, payload: { documentId: id } });
      expect(await pending()).toBe(false);
      const job = await enqueue(db, {
        kind: reclassifyDocumentJob,
        payload: { documentId: id, rejectedTypeId: null, newType: false },
      });
      expect(await pending()).toBe(true);
      await db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, job));
      expect(await pending()).toBe(true);
      await db.update(jobs).set({ status: 'succeeded' }).where(eq(jobs.id, job));
      expect(await pending()).toBe(false);
    });

    it('adds the parts asked for', async () => {
      const id = harness.corpus.idOf('energy-01');
      const document = await getDocument(harness.context, id, {
        include: ['fields', 'provenance'],
      });
      expect(document.fields).toEqual({});
      expect(document.extra).toEqual({});
      expect(document.manual_fields).toEqual([]);
      expect(document.provenance).toHaveProperty('issuer.entity_id');
      expect(document.text).toBeUndefined();
    });

    it('adds the review of the document, by the threshold of the context', async () => {
      // Private, so the lists of the corpus below do not count it.
      const { id } = await insertSyntheticDocument(harness.database.db, {
        status: 'needs_review',
        private: true,
        confidence: 0.5,
        core: { issuer: 'Synthetic Power' },
        provenance: { issuer: { entity_id: 'ent_01SYNTHETIC', match: 'alias', confidence: 0.5 } },
      });
      const read = async (confidenceThreshold: number) =>
        (
          await getDocument({ ...harness.context, confidenceThreshold }, id, {
            include: ['review'],
          })
        ).review;
      expect(await read(0.7)).toEqual({
        threshold: 0.7,
        reasons: ['low_confidence'],
        rejected_values: 0,
        type: { confidence: null, outcome: null, manual: false, doubtful: false },
        values: [
          {
            section: 'core',
            name: 'issuer',
            confidence: 0.5,
            page: null,
            quote: null,
            manual: false,
            doubtful: true,
            confirmable: true,
          },
        ],
      });
      expect(await read(0.4)).toMatchObject({
        reasons: ['flagged_at_settlement'],
        values: [{ doubtful: false }],
      });
    });

    it('returns the text by slices of characters', async () => {
      const id = await harness.corpus.add({
        key: 'two-pages',
        title: 'Two pages',
        type: 'warranty',
        language: 'en',
        pages: ['first page', 'second page'],
      });
      const whole = 'first page\n\nsecond page';
      expect((await getDocument(harness.context, id, { include: ['text'] })).text).toEqual({
        content: whole,
        offset: 0,
        total_length: whole.length,
        has_more: false,
      });
      expect(
        (await getDocument(harness.context, id, { include: ['text'], text_limit: 5 })).text,
      ).toEqual({ content: 'first', offset: 0, total_length: whole.length, has_more: true });
      expect(
        (
          await getDocument(harness.context, id, {
            include: ['text'],
            text_offset: 12,
            text_limit: 500,
          })
        ).text,
      ).toEqual({
        content: 'second page',
        offset: 12,
        total_length: whole.length,
        has_more: false,
      });
    });

    it('returns the pages by ranges', async () => {
      const id = harness.corpus.idOf('two-pages');
      expect(
        (await getDocument(harness.context, id, { include: ['pages'], page_limit: 1 })).pages,
      ).toEqual({
        items: [{ page: 1, text: 'first page', language: 'en' }],
        total: 2,
        has_more: true,
      });
      expect(
        (await getDocument(harness.context, id, { include: ['pages'], page_from: 2 })).pages,
      ).toEqual({
        items: [{ page: 2, text: 'second page', language: 'en' }],
        total: 2,
        has_more: false,
      });
    });

    // A file URL opens the original without any credential for fifteen minutes: it is
    // minted only for a caller who names it, never as part of an ordinary read.
    it('mints no file URL for a private document read without include', async () => {
      const { id } = await upload('private, no include', { private: true });
      for (const include of [[], ['fields', 'text', 'pages', 'provenance']] as const) {
        const document = await getDocument(harness.context, id, { include: [...include] });
        expect([include, Object.hasOwn(document, 'file_url')]).toEqual([include, false]);
      }
      const asked = await getDocument(harness.context, id, { include: ['file_url'] });
      expect(asked.file_url).toMatch(/^https:\/\/liasse\.example\.com\/documents\//);
    });

    it('signs a file URL its own signer accepts', async () => {
      const id = (await upload('signed url')).id;
      const { file_url: fileUrl = '' } = await getDocument(harness.context, id, {
        include: ['file_url'],
      });
      const url = new URL(fileUrl);
      expect(url.pathname).toBe(`/documents/${id}/file`);
      expect(
        harness.context.fileUrls.verify({
          documentId: id,
          expires: url.searchParams.get('expires') ?? '',
          signature: url.searchParams.get('signature') ?? '',
        }),
      ).toBe(true);
    });

    it('does not find an unknown or a deleted document', async () => {
      const { id } = await upload('read after deletion');
      await removeDocument(harness.context, id);
      for (const missing of [id, 'doc_01JC0000000000000000000000']) {
        expect(await failureOf(getDocument(harness.context, missing))).toMatchObject({
          kind: 'not_found',
          code: 'document_not_found',
        });
      }
    });
  });

  describe('listDocumentEvents', () => {
    const log = (documentId: string, event: DocumentEventInput) =>
      harness.database.db.transaction((tx) => recordDocumentEvent(tx, documentId, event));

    it('answers the log of a document, private ones included, oldest first', async () => {
      const { id } = await upload('logged privately', { private: true });
      await log(id, {
        stage: 'text',
        outcome: 'retrying',
        status: 'received',
        attempt: 1,
        maxAttempts: 3,
        errorCode: 'text_process_timeout',
        errorName: 'TextProcessError',
        retryable: true,
      });
      await log(id, {
        stage: 'text',
        outcome: 'succeeded',
        status: 'extracted',
        model: 'synthetic-vision',
        details: { text_method: 'vision', pages: 2 },
      });
      const { events } = await listDocumentEvents(harness.context, id);
      for (const event of events) {
        expect(event.id).toMatch(/^evt_/);
        expect(Date.parse(event.occurred_at)).not.toBeNaN();
      }
      expect(events.map(({ id: _, occurred_at: __, ...event }) => event)).toEqual([
        {
          stage: 'text',
          outcome: 'retrying',
          status: 'received',
          attempt: 1,
          max_attempts: 3,
          error_code: 'text_process_timeout',
          error_name: 'TextProcessError',
          http_status: null,
          provider_code: null,
          retryable: true,
          model: null,
          details: {},
        },
        expect.objectContaining({
          outcome: 'succeeded',
          attempt: null,
          model: 'synthetic-vision',
          details: { text_method: 'vision', pages: 2 },
        }),
      ]);
    });

    it('answers the model, HTTP status and code of a provider failure', async () => {
      const { id } = await upload('refused by the provider');
      await log(id, {
        stage: 'classification',
        outcome: 'failed',
        status: 'failed',
        attempt: 1,
        maxAttempts: 3,
        errorCode: 'model_provider_failed',
        errorName: 'ModelProviderError',
        httpStatus: 400,
        providerCode: 'invalid_request_error:invalid_json_schema',
        retryable: false,
        model: 'synthetic-model',
      });
      const { events } = await listDocumentEvents(harness.context, id);
      expect(events).toMatchObject([
        {
          error_code: 'model_provider_failed',
          http_status: 400,
          provider_code: 'invalid_request_error:invalid_json_schema',
          model: 'synthetic-model',
        },
      ]);
    });

    it('does not find an unknown or a deleted document, whose log is gone with it', async () => {
      const { id } = await upload('log after deletion');
      await log(id, { stage: 'text', outcome: 'succeeded' });
      await removeDocument(harness.context, id);
      for (const missing of [id, 'doc_01JC0000000000000000000000']) {
        expect(await failureOf(listDocumentEvents(harness.context, missing))).toMatchObject({
          kind: 'not_found',
          code: 'document_not_found',
        });
      }
      const left = await harness.database.db
        .select()
        .from(documentEvents)
        .where(eq(documentEvents.documentId, id));
      expect(left).toEqual([]);
    });
  });

  describe('listDocuments', () => {
    const listed = async (options: Parameters<typeof listDocuments>[1] = {}) =>
      listDocuments(harness.context, { limit: 200, ...options });

    it('lists the documents of a status, tombstones and private documents left out', async () => {
      const { id } = await upload('listed then deleted');
      await removeDocument(harness.context, id);
      const { documents: review, total } = await listed({ status: 'needs_review' });
      expect(review.map((document) => document.status)).toEqual(['needs_review', 'needs_review']);
      expect(total).toBe(2);
      const everything = await listed({ private: 'include' });
      expect(everything.documents.map((document) => document.id)).not.toContain(id);
      expect(everything.documents.some((document) => document.status !== 'indexed')).toBe(true);
    });

    it('leaves private documents out unless they are asked for', async () => {
      const titles = async (privacy: 'exclude' | 'include' | 'only') =>
        (await listed({ type: 'property_tax_notice', private: privacy })).documents.map(
          (document) => document.title,
        );
      const taxes = (all: readonly (typeof CORPUS)[number][]) =>
        all.filter(({ type }) => type === 'property_tax_notice').map(({ title }) => title);
      expect((await titles('exclude')).toSorted()).toEqual(taxes(PUBLIC).toSorted());
      expect((await titles('only')).toSorted()).toEqual(taxes(PRIVATE).toSorted());
      expect((await titles('include')).toSorted()).toEqual(taxes(CORPUS).toSorted());
      expect(taxes(PRIVATE)).not.toEqual([]);
      const byDefault = await listDocuments(harness.context, { type: 'property_tax_notice' });
      expect(byDefault.documents.every((document) => !document.private)).toBe(true);
    });

    it('names a type by an alias, with the documents of the types merged into it', async () => {
      const bills = CORPUS.filter(({ type }) =>
        ['energy_bill', 'legacy_power_bill'].includes(type),
      ).length;
      expect((await listed({ type: 'electricity_bill' })).total).toBe(bills);
      expect(await listed({ type: 'no_such_type' })).toEqual({
        documents: [],
        total: 0,
        has_more: false,
      });
    });

    it('names an entity by its id, in any of its entity fields', async () => {
      const issued = PUBLIC.filter(({ issuer }) => issuer === ENTITIES.northwind).length;
      expect((await listed({ entity: ENTITIES.northwind })).total).toBe(issued);
      const received = PUBLIC.filter(({ recipient }) => recipient === ENTITIES.resident).length;
      expect((await listed({ entity: ENTITIES.resident })).total).toBe(received);
      expect((await listed({ entity: 'ent_synthetic_absent' })).total).toBe(0);
    });

    it('pages through the documents, most recent first', async () => {
      const all = await listed({ type: 'payslip' });
      const firstPage = await listDocuments(harness.context, { type: 'payslip', limit: 2 });
      const secondPage = await listDocuments(harness.context, {
        type: 'payslip',
        limit: 2,
        offset: 2,
      });
      expect(firstPage).toMatchObject({ total: all.total, has_more: true });
      expect([...firstPage.documents, ...secondPage.documents]).toEqual(all.documents.slice(0, 4));
      const times = all.documents.map((document) => document.ingested_at);
      expect(times).toEqual(times.toSorted().toReversed());
      expect((await listed({ type: 'payslip', offset: all.total - 1 })).has_more).toBe(false);
    });
  });

  describe('the file of a document', () => {
    it('streams the original bytes with its type and name', async () => {
      const { id } = await upload('original bytes');
      const file = await openDocumentFile(harness.context, id);
      expect(file).toMatchObject({ mime: 'application/pdf', filename: 'original bytes.pdf' });
      expect(await buffer(file.stream)).toEqual(Buffer.from(syntheticPdf('original bytes')));
    });

    it('says the file is missing when the storage lost it', async () => {
      const { id } = await upload('lost file');
      const [row] = await harness.database.db
        .select({ storageKey: documents.storageKey })
        .from(documents)
        .where(eq(documents.id, id));
      await harness.context.storage.delete(parseStorageKey(row?.storageKey ?? ''));
      expect(await failureOf(openDocumentFile(harness.context, id))).toMatchObject({
        kind: 'not_found',
        code: 'file_missing',
      });
    });

    it('does not open the file of a deleted document, nor delete it twice', async () => {
      const { id } = await upload('deleted file');
      await removeDocument(harness.context, id);
      const notFound = { kind: 'not_found', code: 'document_not_found' };
      expect(await failureOf(openDocumentFile(harness.context, id))).toMatchObject(notFound);
      expect(await failureOf(removeDocument(harness.context, id))).toMatchObject(notFound);
    });

    it('runs the deletion hook of the features on the tombstone, and not for nothing', async () => {
      const { id } = await upload('deleted with a hook');
      const seen: { readonly id: string; readonly status: string | undefined }[] = [];
      const context = harness.withFeatures({
        onDocumentDeleted: async (tx, document) => {
          const [row] = await tx
            .select({ status: documents.status })
            .from(documents)
            .where(eq(documents.id, document.id));
          seen.push({ id: document.id, status: row?.status });
        },
      });
      await removeDocument(context, id);
      await failureOf(removeDocument(context, id));
      expect(seen).toEqual([{ id, status: 'deleted' }]);
    });
  });
});
