import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { MAX_HINT_LENGTH } from '../domain/limits.ts';
import { storageKeyOf } from '../storage/key.ts';
import { syntheticEml, syntheticJpeg, syntheticPdf } from '../testing/synthetic-files.ts';
import { buildSyntheticDocx } from '../testing/synthetic-docx.ts';
import { deleteDocument } from './delete-document.ts';
import { EmptyFileError, FileTooLargeError, UnsupportedFormatError } from './errors.ts';
import { ingestFile } from './ingest-file.ts';
import {
  createIngestHarness,
  type IngestHarness,
  TEST_MAX_FILE_SIZE,
} from './harness.test-helper.ts';

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('ingestFile', () => {
  let harness: IngestHarness;

  const documentRows = () => harness.database.db.select().from(documents);
  const jobRows = () => harness.database.db.select().from(jobs);

  const expectNothingStored = async (): Promise<void> => {
    expect(await documentRows()).toEqual([]);
    expect(await jobRows()).toEqual([]);
    expect(await harness.storedFiles()).toEqual([]);
  };

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('stores the file, inserts a received document and queues its processing', async () => {
    const bytes = syntheticPdf('new document');
    const result = await ingestFile(harness.deps, {
      bytes,
      filename: 'invoice.pdf',
      source: 'api',
    });
    expect(result).toMatchObject({ status: 'received', duplicate: false });
    expect(result.id).toMatch(/^doc_/);
    expect(await documentRows()).toMatchObject([
      {
        id: result.id,
        sha256: sha256Of(bytes),
        storageKey: storageKeyOf(sha256Of(bytes)),
        mime: 'application/pdf',
        originalName: 'invoice.pdf',
        source: 'api',
        status: 'received',
      },
    ]);
    const stored = await harness.storage.get(storageKeyOf(sha256Of(bytes)));
    expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
    expect(await jobRows()).toMatchObject([
      { kind: 'process_document', payload: { documentId: result.id }, status: 'queued' },
    ]);
  });

  it('reads a stream as it reads bytes', async () => {
    const bytes = buildSyntheticDocx('<w:p><w:r><w:t>streamed</w:t></w:r></w:p>');
    const chunks = [bytes.subarray(0, 10), bytes.subarray(10, 50), bytes.subarray(50)];
    const result = await ingestFile(harness.deps, {
      stream: Readable.from(chunks),
      filename: 'letter.docx',
      source: 'mcp',
    });
    expect(result.duplicate).toBe(false);
    expect(await documentRows()).toMatchObject([
      {
        sha256: sha256Of(bytes),
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        source: 'mcp',
      },
    ]);
  });

  it('returns the existing document for bytes it already has, and creates nothing', async () => {
    const bytes = syntheticJpeg('twice');
    const first = await ingestFile(harness.deps, { bytes, filename: 'a.jpg', source: 'api' });
    await harness.database.db
      .update(documents)
      .set({ status: 'indexed' })
      .where(eq(documents.id, first.id));
    const second = await ingestFile(harness.deps, { bytes, filename: 'b.jpg', source: 'watch' });
    expect(second).toEqual({
      id: first.id,
      status: 'indexed',
      duplicate: true,
      fileRestored: false,
    });
    expect(await documentRows()).toMatchObject([{ originalName: 'a.jpg', source: 'api' }]);
    expect(await jobRows()).toHaveLength(1);
    expect(harness.puts()).toBe(1);
  });

  it('restores the file of an existing document when the storage lost it', async () => {
    const bytes = syntheticPdf('file lost');
    const first = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    await harness.storage.delete(storageKeyOf(sha256Of(bytes)));
    const again = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
    expect(again).toEqual({
      id: first.id,
      status: 'received',
      duplicate: true,
      fileRestored: true,
    });
    const restored = await harness.storage.get(storageKeyOf(sha256Of(bytes)));
    expect(Buffer.from(restored).equals(Buffer.from(bytes))).toBe(true);
    expect(await jobRows()).toHaveLength(1);
  });

  it('queues a failed document again when its bytes are handed back', async () => {
    const bytes = syntheticPdf('failed before');
    const first = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    await harness.database.db
      .update(documents)
      .set({ status: 'failed', error: 'synthetic failure' })
      .where(eq(documents.id, first.id));
    await harness.database.db.delete(jobs);
    const again = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
    expect(again).toEqual({
      id: first.id,
      status: 'received',
      duplicate: true,
      fileRestored: false,
    });
    expect(await documentRows()).toMatchObject([{ status: 'received', error: null }]);
    expect(await jobRows()).toMatchObject([
      { kind: 'process_document', payload: { documentId: first.id }, status: 'queued' },
    ]);
  });

  describe('a document that keeps failing', () => {
    const bytes = syntheticPdf('keeps failing');

    const failAgain = async (id: string): Promise<void> => {
      await harness.database.db
        .update(documents)
        .set({ status: 'failed', error: 'synthetic failure' })
        .where(eq(documents.id, id));
      await harness.database.db.delete(jobs);
    };

    const handBack = (source: 'watch' | 'api' | 'mcp') =>
      ingestFile(harness.deps, { bytes, filename: 'a.pdf', source });

    it('is queued again once by the watched folder, then left failed at every restart', async () => {
      const { id } = await handBack('watch');
      await failAgain(id);
      expect(await handBack('watch')).toMatchObject({ id, status: 'received', duplicate: true });
      expect(await jobRows()).toHaveLength(1);

      await failAgain(id);
      for (const restart of [1, 2, 3]) {
        expect(await handBack('watch'), `restart ${String(restart)}`).toEqual({
          id,
          status: 'failed',
          duplicate: true,
          fileRestored: false,
        });
      }
      expect(await jobRows()).toEqual([]);
      expect(await documentRows()).toMatchObject([
        { status: 'failed', error: 'synthetic failure' },
      ]);
    });

    it.each(['api', 'mcp'] as const)(
      'is queued again whenever %s hands it back, which gives the folder one more try',
      async (source) => {
        const { id } = await handBack('watch');
        await failAgain(id);
        await handBack('watch');
        await failAgain(id);

        for (const upload of [1, 2]) {
          expect(await handBack(source), `upload ${String(upload)}`).toMatchObject({
            id,
            status: 'received',
            duplicate: true,
          });
          expect(await jobRows()).toHaveLength(1);
          await failAgain(id);
        }

        expect(await handBack('watch')).toMatchObject({ status: 'received' });
        await failAgain(id);
        expect(await handBack('watch')).toMatchObject({ status: 'failed' });
      },
    );
  });

  it('does not bring a deleted document back from the watched folder', async () => {
    const bytes = syntheticPdf('deleted, still in the folder');
    const first = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
    await deleteDocument(harness.deps, first.id);
    await harness.database.db.delete(jobs);
    const putsBefore = harness.puts();
    const again = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
    expect(again).toEqual({
      id: first.id,
      status: 'deleted',
      duplicate: true,
      fileRestored: false,
    });
    expect(await documentRows()).toMatchObject([{ status: 'deleted', originalName: '' }]);
    expect(await jobRows()).toEqual([]);
    expect(harness.puts()).toBe(putsBefore);
  });

  it.each(['api', 'mcp'] as const)(
    'leaves a deleted document deleted when its bytes come through %s inside another file',
    async (source) => {
      const bytes = syntheticPdf(`deleted, then attached through ${source}`);
      const first = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source });
      await deleteDocument(harness.deps, first.id);
      await harness.database.db.delete(jobs);
      const putsBefore = harness.puts();
      const again = await ingestFile(harness.deps, {
        bytes,
        filename: 'a.pdf',
        source,
        revivesDeleted: false,
      });
      expect(again).toEqual({
        id: first.id,
        status: 'deleted',
        duplicate: true,
        fileRestored: false,
      });
      expect(await jobRows()).toEqual([]);
      expect(harness.puts()).toBe(putsBefore);
    },
  );

  it.each(['api', 'mcp'] as const)(
    'revives a deleted document handed back through %s, under the same id',
    async (source) => {
      const bytes = syntheticPdf(`deleted, uploaded again through ${source}`);
      const first = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
      await deleteDocument(harness.deps, first.id);
      await harness.storage.delete(storageKeyOf(sha256Of(bytes)));
      await harness.database.db.delete(jobs);
      const again = await ingestFile(harness.deps, {
        bytes,
        filename: 'again.pdf',
        source,
        hint: 'synthetic second hint',
      });
      expect(again).toEqual({
        id: first.id,
        status: 'received',
        duplicate: false,
        fileRestored: false,
      });
      expect(await documentRows()).toMatchObject([
        {
          id: first.id,
          status: 'received',
          originalName: 'again.pdf',
          source,
          mime: 'application/pdf',
          hint: 'synthetic second hint',
        },
      ]);
      expect(await harness.storage.exists(storageKeyOf(sha256Of(bytes)))).toBe(true);
      expect(await jobRows()).toMatchObject([
        { kind: 'process_document', payload: { documentId: first.id } },
      ]);
    },
  );

  it('makes one document and one file of the same bytes ingested concurrently', async () => {
    const bytes = syntheticPdf('concurrent');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        ingestFile(harness.deps, { bytes, filename: `copy-${String(index)}.pdf`, source: 'api' }),
      ),
    );
    expect(results.filter(({ duplicate }) => !duplicate)).toHaveLength(1);
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(await documentRows()).toHaveLength(1);
    expect(await jobRows()).toHaveLength(1);
    expect(await harness.storedFiles()).toEqual([sha256Of(bytes)]);
    expect(harness.puts()).toBe(1);
  });

  it('trusts the content, not the extension', async () => {
    await ingestFile(harness.deps, {
      bytes: syntheticEml('misnamed'),
      filename: 'message.pdf',
      source: 'api',
    });
    expect(await documentRows()).toMatchObject([
      { mime: 'message/rfc822', originalName: 'message.pdf' },
    ]);
  });

  it('rejects an unsupported format and stores nothing', async () => {
    await expect(
      ingestFile(harness.deps, {
        bytes: new TextEncoder().encode('synthetic plain text'),
        filename: 'invoice.pdf',
        source: 'api',
      }),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
    await expectNothingStored();
  });

  it('rejects an empty file', async () => {
    await expect(
      ingestFile(harness.deps, { bytes: new Uint8Array(), filename: 'empty.pdf', source: 'api' }),
    ).rejects.toBeInstanceOf(EmptyFileError);
    await expect(
      ingestFile(harness.deps, { stream: Readable.from([]), filename: 'empty.pdf', source: 'api' }),
    ).rejects.toBeInstanceOf(EmptyFileError);
    await expectNothingStored();
  });

  it('accepts a file of exactly the size limit and rejects one byte more', async () => {
    const atLimit = new Uint8Array(TEST_MAX_FILE_SIZE);
    atLimit.set(syntheticPdf('at the limit'));
    const overLimit = new Uint8Array(TEST_MAX_FILE_SIZE + 1);
    overLimit.set(syntheticPdf('over the limit'));
    await expect(
      ingestFile(harness.deps, { bytes: overLimit, filename: 'big.pdf', source: 'api' }),
    ).rejects.toMatchObject({ name: 'FileTooLargeError', maxFileSize: TEST_MAX_FILE_SIZE });
    await expectNothingStored();
    const accepted = await ingestFile(harness.deps, {
      bytes: atLimit,
      filename: 'limit.pdf',
      source: 'api',
    });
    expect(accepted.duplicate).toBe(false);
  });

  it('stops reading a stream once it exceeds the size limit', async () => {
    const chunk = new Uint8Array(TEST_MAX_FILE_SIZE / 4);
    const state = { produced: 0, closed: false };
    const endless = async function* (): AsyncGenerator<Uint8Array> {
      try {
        for (;;) {
          state.produced += 1;
          yield await Promise.resolve(chunk);
        }
      } finally {
        state.closed = true;
      }
    };
    await expect(
      ingestFile(harness.deps, { stream: endless(), filename: 'endless.pdf', source: 'api' }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
    expect(state).toEqual({ produced: 5, closed: true });
    await expectNothingStored();
  });

  it('keeps the hint for the pipeline, cut to its maximum length', async () => {
    const hinted = await ingestFile(harness.deps, {
      bytes: syntheticPdf('hinted'),
      filename: 'hinted.pdf',
      source: 'mcp',
      hint: `  electricity bill ${'x'.repeat(MAX_HINT_LENGTH)}`,
    });
    expect(await documentRows()).toMatchObject([
      { id: hinted.id, hint: `electricity bill ${'x'.repeat(MAX_HINT_LENGTH - 19)}` },
    ]);
    expect((await jobRows())[0]?.payload).toEqual({ documentId: hinted.id });
  });

  it('stores no hint when none is given', async () => {
    await ingestFile(harness.deps, {
      bytes: syntheticPdf('no hint'),
      filename: 'a.pdf',
      source: 'api',
      hint: '   ',
    });
    expect(await documentRows()).toMatchObject([{ hint: null }]);
  });

  it('stores a hint and a name that hold characters Postgres refuses', async () => {
    const result = await ingestFile(harness.deps, {
      bytes: syntheticPdf('awkward text'),
      filename: 'in\0voice\ud83d.pdf',
      source: 'api',
      hint: 'half a pair \ud83d and a NUL \0',
    });
    expect(await documentRows()).toMatchObject([
      { id: result.id, originalName: 'invoice.pdf', hint: 'half a pair  and a NUL' },
    ]);
  });

  it('keeps only the last segment of a client path as the name', async () => {
    await ingestFile(harness.deps, {
      bytes: syntheticPdf('path'),
      filename: '../../inbox/2026/invoice.pdf',
      source: 'watch',
    });
    expect(await documentRows()).toMatchObject([{ originalName: 'invoice.pdf' }]);
  });

  it('inserts no document when its job cannot be queued, and recovers on the next try', async () => {
    const bytes = syntheticPdf('job refused');
    await harness.database.db.execute(
      sql`ALTER TABLE jobs ADD CONSTRAINT synthetic_refusal CHECK (kind <> 'process_document')`,
    );
    try {
      await expect(
        ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' }),
      ).rejects.toThrow();
    } finally {
      await harness.database.db.execute(sql`ALTER TABLE jobs DROP CONSTRAINT synthetic_refusal`);
    }
    expect(await documentRows()).toEqual([]);
    expect(await jobRows()).toEqual([]);
    // The file was written before the transaction failed: an orphan, which is accepted.
    expect(await harness.storedFiles()).toEqual([sha256Of(bytes)]);

    const retried = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    expect(retried.duplicate).toBe(false);
    expect(await documentRows()).toHaveLength(1);
    expect(await jobRows()).toHaveLength(1);
    expect(await harness.storedFiles()).toEqual([sha256Of(bytes)]);
  });

  it('queues no job when the document cannot be committed', async () => {
    // A deferred constraint trigger fails at COMMIT, after the document and the job
    // were both written: a job queued outside the transaction would survive it.
    await harness.database.db.execute(sql`
      CREATE FUNCTION synthetic_refusal() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$`);
    await harness.database.db.execute(sql`
      CREATE CONSTRAINT TRIGGER synthetic_refusal AFTER INSERT ON documents
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_refusal()`);
    try {
      await expect(
        ingestFile(harness.deps, {
          bytes: syntheticPdf('commit refused'),
          filename: 'a.pdf',
          source: 'api',
        }),
      ).rejects.toThrow('synthetic commit failure');
    } finally {
      await harness.database.db.execute(sql`DROP TRIGGER synthetic_refusal ON documents`);
      await harness.database.db.execute(sql`DROP FUNCTION synthetic_refusal()`);
    }
    expect(await documentRows()).toEqual([]);
    expect(await jobRows()).toEqual([]);
  });

  it('inserts no document when the file cannot be stored', async () => {
    const failing = {
      ...harness.deps,
      storage: {
        ...harness.storage,
        put: () => Promise.reject(new Error('synthetic storage failure')),
      },
    };
    await expect(
      ingestFile(failing, { bytes: syntheticPdf('unstored'), filename: 'a.pdf', source: 'api' }),
    ).rejects.toThrow('synthetic storage failure');
    await expectNothingStored();
  });
});
