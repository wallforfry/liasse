import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentPages, documents } from '../db/schema/documents.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import { storageKeyOf } from '../storage/key.ts';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { syntheticPdf, syntheticPng } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { getDocumentFile } from './document-file.ts';
import { lockFile } from './file-lock.ts';
import { ingestFile } from './ingest-file.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';

const keyOf = (bytes: Uint8Array) => storageKeyOf(createHash('sha256').update(bytes).digest('hex'));

describe('deleteDocument and getDocumentFile', () => {
  let harness: IngestHarness;

  const ingest = (bytes: Uint8Array, filename = 'synthetic.pdf') =>
    ingestFile(harness.deps, { bytes, filename, source: 'api' });

  const documentIds = async (): Promise<readonly string[]> =>
    (await harness.database.db.select({ id: documents.id }).from(documents)).map(({ id }) => id);

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('deletes the document, its derived rows and its file', async () => {
    const bytes = syntheticPdf('deleted');
    const kept = await ingest(syntheticPdf('kept'));
    const { id } = await ingest(bytes);
    await harness.database.db.insert(documentPages).values({ documentId: id, page: 1, text: 'p' });
    expect(await deleteDocument(harness.deps, id)).toBe(true);
    expect(await documentIds()).toEqual([kept.id]);
    expect(await harness.database.db.select().from(documentPages)).toEqual([]);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(false);
    expect(await harness.storage.exists(keyOf(syntheticPdf('kept')))).toBe(true);
  });

  it('answers false for a document that does not exist', async () => {
    expect(await deleteDocument(harness.deps, 'doc_synthetic_missing')).toBe(false);
  });

  it('lets the same bytes be ingested again after a deletion', async () => {
    const bytes = syntheticPdf('again');
    const first = await ingest(bytes);
    await deleteDocument(harness.deps, first.id);
    const second = await ingest(bytes);
    expect(second).toMatchObject({ duplicate: false });
    expect(second.id).not.toBe(first.id);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('removes the rows even when the file cannot be deleted, and says so', async () => {
    const bytes = syntheticPdf('undeletable file');
    const { id } = await ingest(bytes);
    const failing = {
      ...harness.deps,
      storage: {
        ...harness.storage,
        delete: () => Promise.reject(new Error('synthetic storage failure')),
      },
    };
    await expect(deleteDocument(failing, id)).rejects.toThrow('synthetic storage failure');
    expect(await documentIds()).toEqual([]);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('keeps the file when the same bytes were ingested again before the file deletion', async () => {
    const bytes = syntheticPdf('ingested again meanwhile');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { id } = await ingest(bytes);
    const rowDeleted = createGate();
    let deletion: Promise<boolean> = Promise.resolve(false);
    // The test holds the lock an ingestion would hold, and inserts the row it would insert.
    await harness.database.db.transaction(async (tx) => {
      await lockFile(tx, sha256);
      deletion = deleteDocument(harness.deps, id);
      await waitUntil(async () => (await documentIds()).length === 0);
      rowDeleted.open();
      await sleep(150);
      await tx.insert(documents).values({
        sha256,
        storageKey: keyOf(bytes),
        mime: 'application/pdf',
        originalName: 'again.pdf',
        source: 'api',
      });
    });
    await rowDeleted.opened;
    expect(await deletion).toBe(true);
    expect(await documentIds()).toHaveLength(1);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('makes an ingestion of the same bytes wait for a deletion in progress', async () => {
    const bytes = syntheticPdf('deleted while ingested');
    const { id } = await ingest(bytes);
    const deleting = createGate();
    const proceed = createGate();
    const slowDeletion = {
      ...harness.deps,
      storage: {
        ...harness.storage,
        delete: async (key: Parameters<typeof harness.storage.delete>[0]) => {
          deleting.open();
          await proceed.opened;
          await harness.storage.delete(key);
        },
      },
    };
    const deletion = deleteDocument(slowDeletion, id);
    await deleting.opened;
    const ingestion = ingest(bytes);
    await Promise.race([ingestion, sleep(300)]);
    proceed.open();
    expect(await deletion).toBe(true);
    const reingested = await ingestion;
    expect(reingested).toMatchObject({ duplicate: false });
    expect(await documentIds()).toEqual([reingested.id]);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(true);
  });

  it('serves the original file of a document without its storage location', async () => {
    const bytes = syntheticPng('served');
    const { id } = await ingest(bytes, 'scan.png');
    const file = await getDocumentFile(harness.deps, id);
    expect(file).toMatchObject({
      mime: 'image/png',
      filename: 'scan.png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(Object.keys(file ?? {}).sort()).toEqual([
      'bytes',
      'filename',
      'mime',
      'sha256',
      'stream',
    ]);
    expect(Buffer.from((await file?.bytes()) ?? []).equals(Buffer.from(bytes))).toBe(true);
    const stream = await file?.stream();
    expect(
      stream === undefined ? undefined : (await buffer(stream)).equals(Buffer.from(bytes)),
    ).toBe(true);
  });

  it('has no file for a document that does not exist', async () => {
    expect(await getDocumentFile(harness.deps, 'doc_synthetic_missing')).toBeUndefined();
  });

  it('rejects with a typed error when the stored file is gone', async () => {
    const bytes = syntheticPdf('file lost');
    const { id } = await ingest(bytes);
    await harness.storage.delete(keyOf(bytes));
    const file = await getDocumentFile(harness.deps, id);
    await expect(file?.bytes()).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(file?.stream()).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('refuses a stored key that is not a file hash', async () => {
    const { id } = await ingest(syntheticPdf('tampered key'));
    await harness.database.db
      .update(documents)
      .set({ storageKey: '../../etc/passwd' })
      .where(eq(documents.id, id));
    await expect(getDocumentFile(harness.deps, id)).rejects.toThrow(
      'A storage key is the sharded SHA-256 of a file',
    );
  });
});
