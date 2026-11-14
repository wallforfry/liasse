import { buffer } from 'node:stream/consumers';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { CORPUS } from '../search/corpus.fixture.ts';
import { parseStorageKey } from '../storage/key.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
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
      expect(Object.keys(document)).not.toEqual(
        expect.arrayContaining(['fields', 'extra', 'provenance', 'text', 'pages', 'file_url']),
      );
      const [row] = await harness.database.db.select().from(documents).where(eq(documents.id, id));
      const serialised = JSON.stringify(
        await getDocument(harness.context, id, {
          include: ['fields', 'text', 'pages', 'file_url', 'provenance'],
        }),
      );
      expect(serialised).not.toContain(row?.storageKey);
      expect(serialised).not.toContain(row?.sha256);
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
  });
});
