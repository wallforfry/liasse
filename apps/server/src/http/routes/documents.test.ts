import { documents, jobs } from '@liasse/core/db';
import { PIPELINE_PROVENANCE_KEY } from '@liasse/core/domain';
import { recordDocumentEvent } from '@liasse/core/processing-log';
import { syntheticEml, syntheticPdf } from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createHttpHarness,
  type HttpHarness,
  jsonRequest,
  TEST_MAX_FILE_SIZE,
} from '../harness.test-helper.ts';

const uploaded = z.object({ id: z.string(), status: z.string(), duplicate: z.boolean() });
const failed = z.object({ error: z.looseObject({ code: z.string() }) });
const view = z.looseObject({ id: z.string(), private: z.boolean() });
const list = z.object({
  documents: z.array(view),
  total: z.number(),
  has_more: z.boolean(),
});

const form = (
  file: Uint8Array<ArrayBuffer> | undefined,
  fields: Readonly<Record<string, string>> = {},
  filename = 'invoice.pdf',
): FormData => {
  const data = new FormData();
  if (file !== undefined) data.append('file', new File([file], filename));
  Object.entries(fields).forEach(([name, value]) => {
    data.append(name, value);
  });
  return data;
};

describe('document routes', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const post = (body: FormData) => harness.call('/documents', { method: 'POST', body });
  const codeOf = async (response: Response) => failed.parse(await response.json()).error.code;
  const rowOf = async (id: string) => {
    const [row] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
    return row;
  };

  describe('POST /documents', () => {
    it('stores a multipart upload, answers 201 and queues its processing', async () => {
      const response = await post(form(syntheticPdf('first upload'), { hint: 'a synthetic bill' }));
      expect(response.status).toBe(201);
      const body = uploaded.parse(await response.json());
      expect(body).toEqual({ id: body.id, status: 'received', duplicate: false });
      expect(response.headers.get('Location')).toBe(`/documents/${body.id}`);
      expect(await rowOf(body.id)).toMatchObject({
        source: 'api',
        originalName: 'invoice.pdf',
        hint: 'a synthetic bill',
        private: false,
        mime: 'application/pdf',
      });
      const queued = await harness.database.db.select().from(jobs);
      expect(queued.map((job) => [job.kind, job.payload])).toContainEqual([
        'process_document',
        { documentId: body.id },
      ]);
    });

    it('answers 200 for bytes that already have a document', async () => {
      const first = uploaded.parse(await (await post(form(syntheticPdf('twice')))).json());
      const second = await post(form(syntheticPdf('twice')));
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ ...first, duplicate: true });
    });

    it('flags the document private when the form says so', async () => {
      const response = await post(form(syntheticPdf('private upload'), { private: 'true' }));
      const { id } = uploaded.parse(await response.json());
      expect((await rowOf(id))?.private).toBe(true);
    });

    it('takes a raw body with its name in a header', async () => {
      const response = await harness.call('/documents?private=true&hint=raw%20hint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': encodeURIComponent('relevé été.eml'),
        },
        body: syntheticEml('raw upload'),
      });
      expect(response.status).toBe(201);
      const { id } = uploaded.parse(await response.json());
      expect(await rowOf(id)).toMatchObject({
        originalName: 'relevé été.eml',
        mime: 'message/rfc822',
        hint: 'raw hint',
        private: true,
      });
    });

    it('keeps only the last segment of a name that is a path', async () => {
      const response = await post(
        form(syntheticPdf('path name'), {}, '../../etc/passwd\u0000.pdf'),
      );
      const { id } = uploaded.parse(await response.json());
      expect((await rowOf(id))?.originalName).toBe('passwd.pdf');
    });

    it('refuses a file over the limit, in a form or raw, and stores nothing', async () => {
      const before = await harness.database.db.$count(documents);
      const large = new Uint8Array(TEST_MAX_FILE_SIZE + 1).fill(0x25);
      const responses = [
        await post(form(large)),
        await post(form(new Uint8Array(3 * 1024 * 1024))),
        await harness.call('/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: large,
        }),
      ];
      for (const response of responses) {
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
          error: { code: 'file_too_large', max_file_size: TEST_MAX_FILE_SIZE },
        });
      }
      expect(await harness.database.db.$count(documents)).toBe(before);
    });

    it('refuses a form larger than a file may be, even around a small file', async () => {
      const response = await post(
        form(syntheticPdf('small file, large form'), { hint: 'x'.repeat(2 * 1024 * 1024) }),
      );
      expect(response.status).toBe(413);
    });

    it('refuses a format ingestion does not read with 415', async () => {
      const response = await post(form(new TextEncoder().encode('just a note')));
      expect(response.status).toBe(415);
      expect(await codeOf(response)).toBe('unsupported_format');
    });

    it.each([
      ['an empty file', () => form(new Uint8Array()), 'empty_file'],
      ['no file', () => form(undefined, { hint: 'alone' }), 'invalid_request'],
      [
        'two files',
        () => {
          const data = form(syntheticPdf('one of two'));
          data.append('file', new File([syntheticPdf('two of two')], 'second.pdf'));
          return data;
        },
        'invalid_request',
      ],
      ['a file sent as text', () => form(undefined, { file: 'not a file' }), 'invalid_request'],
      ['an unknown field', () => form(syntheticPdf('extra'), { owner: 'x' }), 'invalid_request'],
      [
        'a flag that is not one',
        () => form(syntheticPdf('flag'), { private: 'yes' }),
        'invalid_request',
      ],
    ])('refuses %s with 400', async (_, body, code) => {
      const response = await post(body());
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe(code);
    });

    it('says what a flag accepts, without echoing what it was given', async () => {
      const expected = '"private" is "true" or "false".';
      const refusals = [
        await post(form(syntheticPdf('flag message'), { private: 'synthetic-maybe' })),
        await harness.call('/documents?private=synthetic-maybe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'flag.pdf' },
          body: syntheticPdf('flag message raw'),
        }),
      ];
      for (const response of refusals) {
        expect(response.status).toBe(400);
        const text = await response.text();
        expect(failed.parse(JSON.parse(text)).error.message).toBe(expected);
        expect(text).not.toContain('synthetic-maybe');
      }
    });

    it('refuses a body that is neither a form nor raw bytes', async () => {
      const response = await harness.call('/documents', jsonRequest('POST', { file: 'x' }));
      expect(response.status).toBe(415);
      expect(await codeOf(response)).toBe('unsupported_media_type');
    });

    it('refuses a raw name that is not percent-encoded', async () => {
      const response = await harness.call('/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': '%E0%A4%A' },
        body: syntheticPdf('bad name'),
      });
      expect(response.status).toBe(400);
    });
  });

  describe('GET /documents and /documents/:id', () => {
    it('reads a document with the parts of the include list', async () => {
      const id = await harness.addDocument(['first page', 'second page'], { title: 'Two pages' });
      const bare = await harness.call(`/documents/${id}`);
      expect(bare.status).toBe(200);
      expect(await bare.json()).not.toHaveProperty('text');
      const full = await harness.call(
        `/documents/${id}?include=text,pages,fields,provenance,file_url&text_limit=5&page_limit=1`,
      );
      const document = z.looseObject({ file_url: z.string() }).parse(await full.json());
      expect(document).toMatchObject({
        id,
        title: 'Two pages',
        text: { content: 'first', has_more: true },
        pages: { items: [{ page: 1 }], total: 2, has_more: true },
        fields: {},
        provenance: {},
      });
      expect(document.file_url).toContain(`https://liasse.example.com/documents/${id}/file?`);
    });

    it('reads the review of a flagged document', async () => {
      const id = await harness.addDocument([], {
        status: 'needs_review',
        private: true,
        confidence: 0.9,
        error: 'reextraction_failed',
        provenance: { '@pipeline': { type: { model: 'm', confidence: 0.9, outcome: 'fallback' } } },
      });
      const response = await harness.call(`/documents/${id}?include=review`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        review: {
          threshold: 0.7,
          reasons: ['type_fallback', 'reextraction_failed'],
          type: { confidence: 0.9, outcome: 'fallback', manual: false, doubtful: true },
          values: [],
        },
      });
    });

    it.each(['include=secrets', 'text_limit=0', 'text_limit=1e3', 'page_from=-1', 'verbose=1'])(
      'refuses the query %s',
      async (query) => {
        const id = await harness.addDocument([]);
        const response = await harness.call(`/documents/${id}?${query}`);
        expect(response.status).toBe(400);
        expect(await codeOf(response)).toBe('invalid_request');
      },
    );

    it('lists documents with the filters of the query string', async () => {
      await harness.addDocument([], { status: 'needs_review', private: true });
      const review = list.parse(
        await (await harness.call('/documents?status=needs_review&private=only&limit=1')).json(),
      );
      expect(review.documents).toHaveLength(1);
      expect(review.documents[0]?.private).toBe(true);
      const hidden = list.parse(
        await (await harness.call('/documents?status=needs_review')).json(),
      );
      expect(hidden.documents.every((document) => !document.private)).toBe(true);
      const named = list.parse(
        await (await harness.call('/documents?entity=ent_synthetic_absent')).json(),
      );
      expect(named).toEqual({ documents: [], total: 0, has_more: false });
      expect((await harness.call('/documents?status=deleted')).status).toBe(400);
      expect((await harness.call('/documents?limit=1000')).status).toBe(400);
    });

    it('answers 404 for an id no document has', async () => {
      const response = await harness.call('/documents/doc_01JC0000000000000000000000');
      expect(response.status).toBe(404);
      expect(await codeOf(response)).toBe('document_not_found');
    });

    it.each(['..%2F..%2Fetc%2Fpasswd', '%00', 'doc_%00', 'a'.repeat(65), "doc'%20OR%201=1"])(
      'refuses the id %s before it reaches the database',
      async (id) => {
        for (const method of ['GET', 'DELETE']) {
          const response = await harness.call(`/documents/${id}`, { method });
          expect([method, response.status]).toEqual([method, 400]);
          expect(await codeOf(response)).toBe('invalid_request');
        }
        expect((await harness.call(`/documents/${id}/file`)).status).toBe(400);
      },
    );
  });

  describe('GET /documents/:id/events', () => {
    const events = z.object({
      events: z.array(z.looseObject({ stage: z.string(), outcome: z.string() })),
    });

    it('answers the processing log of a document, a private one included', async () => {
      const id = await harness.addDocument([], { status: 'failed', private: true });
      await harness.database.db.transaction((tx) =>
        recordDocumentEvent(tx, id, {
          stage: 'extraction',
          outcome: 'failed',
          status: 'failed',
          attempt: 3,
          maxAttempts: 3,
          errorCode: 'model_output_invalid',
          details: { rejected_values: 4 },
        }),
      );
      const response = await harness.call(`/documents/${id}/events`);
      expect(response.status).toBe(200);
      expect(events.parse(await response.json()).events).toMatchObject([
        {
          stage: 'extraction',
          outcome: 'failed',
          attempt: 3,
          max_attempts: 3,
          error_code: 'model_output_invalid',
          details: { rejected_values: 4 },
        },
      ]);
    });

    it('answers 404 for an id no document has, and 400 for an id that is not one', async () => {
      const missing = await harness.call('/documents/doc_01JC0000000000000000000000/events');
      expect(missing.status).toBe(404);
      expect(await codeOf(missing)).toBe('document_not_found');
      expect((await harness.call('/documents/doc_%00/events')).status).toBe(400);
    });
  });

  describe('GET /documents/:id/status', () => {
    it('answers a document just uploaded with the job that will process it', async () => {
      const { id } = uploaded.parse(await (await post(form(syntheticPdf('status')))).json());
      const response = await harness.call(`/documents/${id}/status`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id,
        status: 'received',
        state: 'current',
        error: null,
        events: [],
        analysis_pending: true,
        job: { kind: 'process_document', state: 'queued', attempts: 0, waiting_for: 'worker' },
      });
    });

    it('answers 404 for an id no document has', async () => {
      const missing = await harness.call('/documents/doc_01JC0000000000000000000000/status');
      expect(missing.status).toBe(404);
      expect(await codeOf(missing)).toBe('document_not_found');
    });
  });

  describe('DELETE /documents/:id', () => {
    it('answers 204 once, then 404: the document is gone', async () => {
      const { id } = uploaded.parse(await (await post(form(syntheticPdf('to delete')))).json());
      const first = await harness.call(`/documents/${id}`, { method: 'DELETE' });
      expect(first.status).toBe(204);
      expect(await first.text()).toBe('');
      const second = await harness.call(`/documents/${id}`, { method: 'DELETE' });
      expect(second.status).toBe(404);
      expect((await harness.call(`/documents/${id}`)).status).toBe(404);
    });
  });

  describe('POST /documents/:id/retry', () => {
    const retry = (id: string) => harness.call(`/documents/${id}/retry`, { method: 'POST' });

    it('queues a failed document again and answers 202 with it', async () => {
      const { id } = uploaded.parse(await (await post(form(syntheticPdf('to retry')))).json());
      await harness.database.db
        .update(documents)
        .set({ status: 'failed', error: 'model_provider_failed' })
        .where(eq(documents.id, id));
      await harness.database.db.delete(jobs).where(eq(jobs.kind, 'process_document'));
      const response = await retry(id);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ id, status: 'received', error: null });
      const queued = await harness.database.db
        .select()
        .from(jobs)
        .where(eq(jobs.kind, 'process_document'));
      expect(queued.map(({ payload }) => payload)).toContainEqual({ documentId: id });
    });

    it('refuses a document that did not fail with 400, and an unknown one with 404', async () => {
      const { id } = uploaded.parse(await (await post(form(syntheticPdf('not failed')))).json());
      const notFailed = await retry(id);
      expect(notFailed.status).toBe(400);
      expect(await codeOf(notFailed)).toBe('document_not_failed');
      const unknown = await retry('doc_01JC0000000000000000000000');
      expect(unknown.status).toBe(404);
      expect(await codeOf(unknown)).toBe('document_not_found');
    });
  });

  describe('POST /documents/:id/reclassify', () => {
    const reclassify = (id: string, body: unknown) =>
      harness.call(`/documents/${id}/reclassify`, jsonRequest('POST', body));

    it('queues the type of a settled document again and answers 202 with it', async () => {
      const id = await harness.addDocument([]);
      const response = await reclassify(id, { hint: 'a payslip', new_type: true });
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ id, status: 'indexed' });
      const queued = await harness.database.db
        .select()
        .from(jobs)
        .where(eq(jobs.kind, 'reclassify_document'));
      expect(queued.map(({ payload }) => payload)).toContainEqual({
        documentId: id,
        rejectedTypeId: null,
        newType: true,
      });
      const [document] = await harness.database.db
        .select({ hint: documents.reclassificationHint })
        .from(documents)
        .where(eq(documents.id, id));
      expect(document).toEqual({ hint: 'a payslip' });
    });

    it('queues a document the removed daily quota of new types left untyped', async () => {
      const id = await harness.addDocument([], {
        status: 'needs_review',
        typeId: null,
        provenance: {
          [PIPELINE_PROVENANCE_KEY]: {
            type: { model: 'm', confidence: 0, outcome: 'untyped', refusal: 'quota_exceeded' },
          },
        },
      });
      const read = await harness.call(`/documents/${id}?include=review`);
      expect(await read.json()).toMatchObject({
        review: { type: { outcome: 'untyped', refusal: 'quota_exceeded' } },
      });
      const response = await reclassify(id, {});
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ id, status: 'needs_review' });
      const queued = await harness.database.db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.kind, 'reclassify_document'));
      expect(queued.map(({ payload }) => payload)).toContainEqual({
        documentId: id,
        rejectedTypeId: null,
        newType: false,
      });
    });

    it('refuses a document that is not settled, an unknown one, and other options', async () => {
      const id = await harness.addDocument([], { status: 'classified' });
      const notSettled = await reclassify(id, {});
      expect(notSettled.status).toBe(400);
      expect(await codeOf(notSettled)).toBe('document_not_settled');
      const unknown = await reclassify('doc_01JC0000000000000000000000', {});
      expect(unknown.status).toBe(404);
      expect(await codeOf(unknown)).toBe('document_not_found');
      expect((await reclassify(id, { type: 'payslip' })).status).toBe(400);
    });
  });

  describe('POST /documents/reclassify', () => {
    const reclassifyFlagged = (body: unknown) =>
      harness.call('/documents/reclassify', jsonRequest('POST', body));

    it('queues the documents flagged with a type reason and answers 202 with the counts', async () => {
      const id = await harness.addDocument([], {
        status: 'needs_review',
        typeId: null,
        provenance: {
          [PIPELINE_PROVENANCE_KEY]: {
            type: { model: 'm', confidence: 0, outcome: 'fallback' },
          },
        },
      });
      const response = await reclassifyFlagged({ reason: 'type_fallback' });
      expect(response.status).toBe(202);
      // Other tests of this file flag documents too: only this one is known to be queued.
      expect(await response.json()).toMatchObject({ skipped: 0, remaining: 0 });
      const queued = await harness.database.db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.kind, 'reclassify_document'));
      expect(queued.map(({ payload }) => payload)).toContainEqual({
        documentId: id,
        rejectedTypeId: null,
        newType: false,
      });
    });

    it('refuses a reason that is not a type reason, and a limit beyond the bound', async () => {
      const lowConfidence = await reclassifyFlagged({ reason: 'low_confidence' });
      expect(lowConfidence.status).toBe(400);
      expect((await reclassifyFlagged({ reason: 'type_untyped', limit: 101 })).status).toBe(400);
      expect((await reclassifyFlagged({})).status).toBe(400);
    });
  });

  describe('POST /documents/:id/reextract', () => {
    const reextract = (id: string) =>
      harness.call(`/documents/${id}/reextract`, { method: 'POST' });

    it('queues the values of a settled document again and answers 202 with it', async () => {
      const id = await harness.addDocument([], { status: 'needs_review' });
      const response = await reextract(id);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        id,
        status: 'needs_review',
        analysis_pending: true,
      });
      const queued = await harness.database.db
        .select()
        .from(jobs)
        .where(eq(jobs.kind, 'reextract_document'));
      expect(queued.map(({ payload }) => payload)).toContainEqual({ documentId: id });
    });

    it('refuses a document that is not settled with 400, and an unknown one with 404', async () => {
      const id = await harness.addDocument([], { status: 'failed', error: 'no_text' });
      const notSettled = await reextract(id);
      expect(notSettled.status).toBe(400);
      expect(await codeOf(notSettled)).toBe('document_not_settled');
      const unknown = await reextract('doc_01JC0000000000000000000000');
      expect(unknown.status).toBe(404);
      expect(await codeOf(unknown)).toBe('document_not_found');
    });
  });

  describe('PATCH /documents/:id', () => {
    it('answers 501 while the pipeline is not bound', async () => {
      const id = await harness.addDocument([]);
      const response = await harness.call(
        `/documents/${id}`,
        jsonRequest('PATCH', { private: true }),
      );
      expect(response.status).toBe(501);
      expect(await codeOf(response)).toBe('not_implemented');
    });

    it('hands the correction to the pipeline and answers with the document', async () => {
      const id = await harness.addDocument([]);
      const received: unknown[] = [];
      const app = harness.appWith({
        features: {
          correctDocument: async (input) => {
            received.push(input);
            await harness.database.db
              .update(documents)
              .set({ private: true })
              .where(eq(documents.id, id));
            return { ok: true };
          },
        },
      });
      const response = await app.request(`/documents/${id}`, {
        ...jsonRequest('PATCH', {
          private: true,
          core: { reference: 'SYN-1' },
          confirm: { issuer: 'Synthetic Power' },
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${harness.token}`,
        },
      });
      expect(response.status).toBe(200);
      expect(received).toEqual([
        { id, private: true, core: { reference: 'SYN-1' }, confirm: { issuer: 'Synthetic Power' } },
      ]);
      expect(await response.json()).toMatchObject({
        id,
        private: true,
        fields: {},
        provenance: {},
      });
    });

    it('refuses a correction of something else than type, core, fields and private', async () => {
      const id = await harness.addDocument([]);
      const response = await harness.call(
        `/documents/${id}`,
        jsonRequest('PATCH', { status: 'indexed', storage_key: 'x' }),
      );
      expect(response.status).toBe(400);
    });
  });
});
