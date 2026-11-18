import { buffer } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteSource } from '../api/sources.ts';
import {
  getDocumentFile,
  SourceFileChangedError,
  SourceFileUnavailableError,
} from '../ingest/document-file.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { createDriveHarness, type DriveHarness } from './gdrive/gdrive.test-helper.ts';

describe('the file of a document kept at its source', () => {
  let harness: DriveHarness;

  beforeAll(async () => {
    harness = await createDriveHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  // A Drive folder holding one file, read once.
  const ingested = async (bytes = syntheticPdf('served')) => {
    const { drive } = harness.google;
    const folder = drive.folder('Served');
    const file = drive.file('served.pdf', folder, bytes);
    const source = await harness.addDriveSource(folder);
    await harness.poll(source);
    const [document] = await harness.liveDocuments();
    if (document === undefined) throw new Error('The file was not ingested');
    return { file, source, id: document.id, bytes };
  };

  const fileOf = async (id: string) => {
    const file = await getDocumentFile(
      { ...harness.ingest.deps, sourceFiles: harness.sourceFiles() },
      id,
    );
    if (file === undefined) throw new Error('The document has no file');
    return file;
  };

  it('is streamed from Drive, the bytes that were indexed', async () => {
    const { id, bytes } = await ingested();
    const file = await fileOf(id);
    expect((await buffer(await file.stream())).equals(Buffer.from(bytes))).toBe(true);
    expect(Buffer.from(await file.bytes()).equals(Buffer.from(bytes))).toBe(true);
  });

  it('is refused as changed when Drive holds another version', async () => {
    const { id, file } = await ingested();
    harness.google.drive.update(file, syntheticPdf('another version'));
    await expect((await fileOf(id)).stream()).rejects.toBeInstanceOf(SourceFileChangedError);
  });

  it('is unavailable once trashed on Drive, before any run sees it', async () => {
    const { id, file } = await ingested();
    harness.google.drive.trash(file);
    await expect((await fileOf(id)).stream()).rejects.toBeInstanceOf(SourceFileUnavailableError);
  });

  it('is unavailable once a run marked its origin removed, even if Drive still serves it', async () => {
    const { id, file, source } = await ingested();
    harness.google.drive.move(file, harness.google.drive.rootId);
    await harness.poll(source);
    await expect((await fileOf(id)).stream()).rejects.toBeInstanceOf(SourceFileUnavailableError);
  });

  it('is unavailable once its source is deleted, whose token is revoked', async () => {
    const { id, source } = await ingested();
    await deleteSource(harness.context(), source);
    expect(harness.google.revoked()).toHaveLength(1);
    await expect((await fileOf(id)).stream()).rejects.toBeInstanceOf(SourceFileUnavailableError);
  });
});
