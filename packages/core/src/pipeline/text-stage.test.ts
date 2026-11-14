import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import { PIPELINE_PROVENANCE_KEY } from '../domain/provenance.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { ModelProviderError } from '../models/errors.ts';
import { createFakeVisionModel } from '../testing/fake-vision-model.ts';
import { syntheticPdf, syntheticPng } from '../testing/synthetic-files.ts';
import { buildSyntheticPdf } from '../testing/synthetic-pdf.ts';
import { TextExtractionError } from '../text/errors.ts';
import type { ExtractedAttachment } from '../text/types.ts';
import type { ExtractDocumentText, PipelineDeps } from './deps.ts';
import { loadDocument } from './document.ts';
import { DocumentProcessingError } from './errors.ts';
import {
  createPipelineHarness,
  live,
  pagesOf,
  type PipelineHarness,
} from './harness.test-helper.ts';
import { runTextStage } from './text-stage.ts';

const BOUNDARY = 'synthetic-boundary';

// Stands for "no extractor injected": the stage then uses its default, a child process.
const USE_DEFAULT: ExtractDocumentText = () => Promise.reject(new Error('replaced by the default'));

const part = (headers: readonly string[], bytes: Uint8Array): string =>
  [
    `--${BOUNDARY}`,
    ...headers,
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(bytes).toString('base64'),
  ].join('\r\n');

const emailWith = (label: string, parts: readonly string[]): Uint8Array =>
  Buffer.from(
    [
      'From: Sender <sender@example.com>',
      'To: recipient@example.org',
      `Subject: ${label}`,
      'Date: Mon, 02 Nov 2026 10:00:00 +0000',
      'Message-ID: <synthetic@example.com>',
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${BOUNDARY}"`,
      '',
      `--${BOUNDARY}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Body of ${label}.`,
      ...parts,
      `--${BOUNDARY}--`,
      '',
    ].join('\r\n'),
    'latin1',
  );

const attached = (filename: string, mime: string, bytes: Uint8Array): string =>
  part([`Content-Type: ${mime}`, `Content-Disposition: attachment; filename="${filename}"`], bytes);

describe('the text stage', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const ingestBytes = async (bytes: Uint8Array, filename: string): Promise<string> =>
    (await ingestFile(harness.ingestHarness.deps, { bytes, filename, source: 'mcp' })).id;

  const run = async (id: string, overrides: Partial<PipelineDeps> = {}): Promise<void> => {
    const document = await loadDocument(harness.db, id);
    if (document === undefined) throw new Error('The document is not live');
    const deps = harness.deps(overrides);
    const { extractText: _injected, ...defaults } = deps;
    await runTextStage(deps.extractText === USE_DEFAULT ? defaults : deps, document, live());
  };

  const pages = (id: string) =>
    harness.db
      .select({ page: documentPages.page, text: documentPages.text })
      .from(documentPages)
      .where(eq(documentPages.documentId, id))
      .orderBy(documentPages.page);

  // The default of the pipeline: a real PDF read by pdfjs in a child process.
  const outOfProcess = { extractText: USE_DEFAULT };

  it('reads a real PDF outside the process and stores its pages', async () => {
    const line = 'Synthetic Energy invoice SYN-2026-001, a text layer long enough to be native. ';
    const bytes = buildSyntheticPdf([{ lines: [line, line] }, { lines: [line, line, 'Page two'] }]);
    const id = await ingestBytes(bytes, 'native.pdf');
    await run(id, outOfProcess);
    const stored = await pages(id);
    expect(stored.map(({ page }) => page)).toEqual([1, 2]);
    expect(stored[1]?.text).toContain('Page two');
    expect(await harness.document(id)).toMatchObject({
      status: 'extracted',
      provenance: {
        [PIPELINE_PROVENANCE_KEY]: {
          text: { method: 'native', attachments_ingested: 0, attachments_skipped: 0 },
        },
      },
    });
  });

  it('transcribes a scanned PDF with the vision model of the server and records which', async () => {
    const vision = createFakeVisionModel(() => 'Transcribed page');
    const id = await ingestBytes(buildSyntheticPdf([{ scanned: true }]), 'scan.pdf');
    await run(id, { ...outOfProcess, visionModel: vision });
    expect(vision.calls).toHaveLength(1);
    expect(await pages(id)).toEqual([{ page: 1, text: 'Transcribed page' }]);
    expect((await harness.document(id)).provenance[PIPELINE_PROVENANCE_KEY]).toMatchObject({
      text: { method: 'vision', vision_model: 'fake-vision-model' },
    });
  });

  // Only a process of its own has a CPU limit to exceed: read in the server, the same
  // file would come out as text.
  it('ends the reading process at the configured limit, and fails for good', async () => {
    const id = await ingestBytes(buildSyntheticPdf([{ lines: ['A short page'] }]), 'cpu.pdf');
    const deps = harness.deps();
    await expect(
      run(id, {
        ...outOfProcess,
        settings: { ...deps.settings, textProcessLimits: { maxCpuMs: 1 } },
      }),
    ).rejects.toMatchObject({ code: 'text_cpu_limit', retryable: false });
    expect(await harness.document(id)).toMatchObject({ status: 'received' });
  });

  it('passes MAX_VISION_PAGES on to the extraction', async () => {
    const id = await ingestBytes(
      buildSyntheticPdf([{ scanned: true }, { scanned: true }]),
      'two.pdf',
    );
    const deps = harness.deps();
    await expect(
      run(id, { ...outOfProcess, settings: { ...deps.settings, maxVisionPages: 1 } }),
    ).rejects.toMatchObject({ code: 'pdf_too_many_scanned_pages', retryable: false });
  });

  it('keeps the code of an extraction failure, and stores nothing', async () => {
    const id = await ingestBytes(
      buildSyntheticPdf([{ lines: ['x'] }], { userPassword: 'synthetic' }),
      'locked.pdf',
    );
    await expect(run(id, outOfProcess)).rejects.toBeInstanceOf(TextExtractionError);
    await expect(run(id, outOfProcess)).rejects.toMatchObject({ code: 'pdf_encrypted' });
    expect(await harness.document(id)).toMatchObject({ status: 'received' });
    expect(await pages(id)).toEqual([]);
  });

  it('lets a failure of the vision model through as it is', async () => {
    const failure = new ModelProviderError({ provider: 'p', model: 'm', retryable: true });
    const id = await ingestBytes(buildSyntheticPdf([{ scanned: true }]), 'vision-down.pdf');
    await expect(
      run(id, {
        ...outOfProcess,
        visionModel: createFakeVisionModel(() => Promise.reject(failure)),
      }),
    ).rejects.toBe(failure);
  });

  it('refuses a document with no text at all', async () => {
    const id = await harness.ingest('blank');
    await expect(
      run(id, { extractText: () => Promise.resolve(pagesOf('  \n ', '')) }),
    ).rejects.toEqual(new DocumentProcessingError('no_text'));
    expect(await harness.document(id)).toMatchObject({ status: 'received' });
  });

  it('replaces the pages of a previous attempt and writes only over `received`', async () => {
    const id = await harness.ingest('twice');
    await harness.db.insert(documentPages).values({ documentId: id, page: 7, text: 'stale' });
    await run(id, { extractText: () => Promise.resolve(pagesOf('fresh')) });
    expect(await pages(id)).toEqual([{ page: 1, text: 'fresh' }]);
    await harness.db.update(documents).set({ status: 'indexed' }).where(eq(documents.id, id));
    await run(id, { extractText: () => Promise.resolve(pagesOf('late writer')) });
    expect(await pages(id)).toEqual([{ page: 1, text: 'fresh' }]);
    expect(await harness.document(id)).toMatchObject({ status: 'indexed' });
  });

  it('ingests each supported attachment of an email as a document linked to it', async () => {
    const invoice = syntheticPdf('attached invoice');
    const email = emailWith('with attachments', [
      attached('invoice.pdf', 'application/pdf', invoice),
      attached('notes.txt', 'text/plain', Buffer.from('plain notes')),
      part(
        [
          'Content-Type: image/png',
          'Content-Disposition: inline; filename="logo.png"',
          'Content-ID: <logo>',
        ],
        syntheticPng('logo'),
      ),
    ]);
    const id = await ingestBytes(email, 'message.eml');
    await run(id, outOfProcess);
    const links = await harness.db.select().from(documentLinks);
    expect(links).toHaveLength(1);
    const [link] = links;
    expect(link).toMatchObject({ toDocumentId: id, kind: 'attachment_of' });
    expect(await harness.document(link?.fromDocumentId ?? '')).toMatchObject({
      status: 'received',
      source: 'mcp',
      originalName: 'invoice.pdf',
      mime: 'application/pdf',
    });
    expect((await harness.document(id)).provenance[PIPELINE_PROVENANCE_KEY]).toMatchObject({
      text: { attachments_ingested: 1, attachments_skipped: 2 },
    });
    expect(await harness.db.select().from(documents)).toHaveLength(2);
  });

  const attachment = (label: string): ExtractedAttachment => ({
    filename: `${label}.pdf`,
    mime: 'application/pdf',
    bytes: syntheticPdf(label),
    inline: false,
  });

  const withAttachments = (...attachments: readonly ExtractedAttachment[]) => ({
    extractText: () => Promise.resolve({ ...pagesOf('An email'), attachments }),
  });

  it('links an attachment whose bytes already have a document, once, however often it runs', async () => {
    const existing = await harness.ingest('already there');
    const id = await harness.ingest('email');
    await run(id, withAttachments(attachment('already there')));
    await harness.db.update(documents).set({ status: 'received' }).where(eq(documents.id, id));
    await run(id, withAttachments(attachment('already there')));
    expect(await harness.db.select().from(documentLinks)).toMatchObject([
      { fromDocumentId: existing, toDocumentId: id },
    ]);
    expect(await harness.db.select().from(documents)).toHaveLength(2);
  });

  // Verdict P5: only an explicit upload of the file itself brings a deleted document back.
  it.each(['watch', 'api', 'mcp'] as const)(
    'never brings back a deleted attachment of an email from %s, nor links an email to itself',
    async (source) => {
      const gone = await harness.ingest('deleted attachment');
      await deleteDocument({ db: harness.db }, gone);
      const id = await harness.ingest('email of a tombstone');
      await harness.db.update(documents).set({ source }).where(eq(documents.id, id));
      const putsBefore = harness.ingestHarness.puts();
      await run(
        id,
        withAttachments(attachment('deleted attachment'), attachment('email of a tombstone')),
      );
      expect(await harness.document(gone)).toMatchObject({ status: 'deleted', originalName: '' });
      expect(harness.ingestHarness.puts()).toBe(putsBefore);
      const queued = await harness.db.select({ payload: jobs.payload }).from(jobs);
      expect(queued.filter(({ payload }) => payload.documentId === gone)).toHaveLength(1);
      expect(await harness.db.select().from(documentLinks)).toEqual([]);
      expect((await harness.document(id)).provenance[PIPELINE_PROVENANCE_KEY]).toMatchObject({
        text: { attachments_ingested: 0, attachments_skipped: 2 },
      });
    },
  );

  it('writes no link to an email deleted while its attachments are ingested', async () => {
    const id = await harness.ingest('email deleted meanwhile');
    const document = await loadDocument(harness.db, id);
    if (document === undefined) throw new Error('The document is not live');
    await runTextStage(
      harness.deps({
        extractText: async () => {
          await deleteDocument({ db: harness.db }, id);
          return { ...pagesOf('An email'), attachments: [attachment('orphan')] };
        },
      }),
      document,
      live(),
    );
    expect(await harness.db.select().from(documentLinks)).toEqual([]);
    expect(await harness.db.select().from(documentPages)).toEqual([]);
    expect(await harness.document(id)).toMatchObject({ status: 'deleted' });
  });
});
