import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { StorageObjectNotFoundError } from '../storage/errors.ts';
import { storageKeyOf } from '../storage/key.ts';
import { NO_SOURCE_FILES } from '../testing/no-source-files.ts';
import { syntheticPdf, syntheticPng } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { getDocumentFile, SourceFileChangedError, type SourceFiles } from './document-file.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('getDocumentFile', () => {
  let harness: IngestHarness;
  const fileDeps = () => ({ ...harness.deps, sourceFiles: NO_SOURCE_FILES });

  const ingest = (bytes: Uint8Array, filename = 'synthetic.pdf') =>
    ingestFile(harness.deps, { bytes, filename, source: 'api' });

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('serves the original file of a document without its storage location', async () => {
    const bytes = syntheticPng('served');
    const { id } = await ingest(bytes, 'scan.png');
    const file = await getDocumentFile(fileDeps(), id);
    expect(file).toMatchObject({
      mime: 'image/png',
      filename: 'scan.png',
      sha256: sha256Of(bytes),
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
    expect(await getDocumentFile(fileDeps(), 'doc_synthetic_missing')).toBeUndefined();
  });

  it('has no file for a deleted document, even before its file is removed', async () => {
    const bytes = syntheticPdf('deleted, file still stored');
    const { id } = await ingest(bytes);
    await deleteDocument(harness.deps, id);
    expect(await harness.storage.exists(storageKeyOf(sha256Of(bytes)))).toBe(true);
    expect(await getDocumentFile(fileDeps(), id)).toBeUndefined();
  });

  it('rejects with a typed error when the stored file is gone', async () => {
    const bytes = syntheticPdf('file lost');
    const { id } = await ingest(bytes);
    await harness.storage.delete(storageKeyOf(sha256Of(bytes)));
    const file = await getDocumentFile(fileDeps(), id);
    await expect(file?.bytes()).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    await expect(file?.stream()).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('refuses a stored key that is not a file hash', async () => {
    const { id } = await ingest(syntheticPdf('tampered key'));
    await harness.database.db
      .update(documents)
      .set({ storageKey: '../../etc/passwd' })
      .where(eq(documents.id, id));
    await expect(getDocumentFile(fileDeps(), id)).rejects.toThrow(
      'A storage key is the sharded SHA-256 of a file',
    );
  });

  it('checks the bytes a source serves against the hash of the document', async () => {
    const bytes = syntheticPdf('kept at a source');
    const { id } = await ingestFile(harness.deps, {
      bytes,
      filename: 'kept.pdf',
      source: 'connector',
      byReference: true,
    });
    const serving = (served: Uint8Array): SourceFiles => ({
      open: () => Promise.resolve(ReadableStream.from([served])),
    });
    const same = await getDocumentFile({ ...harness.deps, sourceFiles: serving(bytes) }, id);
    expect(Buffer.from((await same?.bytes()) ?? []).equals(Buffer.from(bytes))).toBe(true);
    const other = await getDocumentFile(
      { ...harness.deps, sourceFiles: serving(syntheticPdf('other bytes')) },
      id,
    );
    await expect(other?.bytes()).rejects.toBeInstanceOf(SourceFileChangedError);
  });
});
