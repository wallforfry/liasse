import { createHash } from 'node:crypto';
import type { DocumentSource } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { storageKeyOf } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { sessionsWaitingForALock } from '../testing/lock-waits.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { createDeleteFileHandler } from './delete-file-job.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

const keyOf = (bytes: Uint8Array) => storageKeyOf(createHash('sha256').update(bytes).digest('hex'));

// A deletion that commits while an ingestion of the same bytes is at work must stay a
// deletion. The ingestion is held inside its transaction, at the moment it asks the
// storage whether the file is there, which is where a `failed` document is about to be
// queued again.
describe('a deletion racing the ingestion of the same bytes', () => {
  let harness: IngestHarness;

  const statusOf = async (id: string) => {
    const [row] = await harness.database.db
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, id));
    return row?.status;
  };

  const processingJobs = () =>
    harness.database.db.select().from(jobs).where(eq(jobs.kind, 'process_document'));

  const failedDocument = async (bytes: Uint8Array): Promise<string> => {
    const { id } = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'watch' });
    await harness.database.db
      .update(documents)
      .set({ status: 'failed', error: 'synthetic failure' })
      .where(eq(documents.id, id));
    await harness.database.db.delete(jobs);
    return id;
  };

  // Starts an ingestion and resolves once it is waiting on `storage.exists`.
  const heldIngestion = async (bytes: Uint8Array, source: DocumentSource) => {
    const reading = createGate();
    const proceed = createGate();
    const storage: Storage = {
      ...harness.storage,
      exists: async (key) => {
        reading.open();
        await proceed.opened;
        return harness.storage.exists(key);
      },
    };
    const result = ingestFile(
      { ...harness.deps, storage },
      { bytes, filename: 'again.pdf', source },
    );
    await reading.opened;
    return { result, release: proceed.open };
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

  it('waits for the ingestion, then deletes what it left', async () => {
    const bytes = syntheticPdf('failed, deleted during a restart');
    const id = await failedDocument(bytes);
    const ingestion = await heldIngestion(bytes, 'watch');

    const deletion = deleteDocument(harness.deps, id);
    await waitUntil(async () => (await sessionsWaitingForALock(harness.database.db)) === 1);
    ingestion.release();
    await ingestion.result;
    expect(await deletion).toBe(true);
    await createDeleteFileHandler({ db: harness.database.db, storage: harness.storage }).run(
      { documentId: id },
      { signal: new AbortController().signal, attempt: 1 },
    );

    expect(await statusOf(id)).toBe('deleted');
    expect(await processingJobs()).toEqual([]);
    expect(await harness.storage.exists(keyOf(bytes))).toBe(false);
  });

  it('does not queue a document again once it has become a tombstone', async () => {
    const bytes = syntheticPdf('failed, tombstoned behind the back of the ingestion');
    const id = await failedDocument(bytes);
    const ingestion = await heldIngestion(bytes, 'watch');

    // What a deletion writes, without the lock a deletion takes: the write of the
    // ingestion must hold on its own.
    await harness.database.db
      .update(documents)
      .set({ status: 'deleted', originalName: '', error: null })
      .where(eq(documents.id, id));
    ingestion.release();

    expect(await ingestion.result).toEqual({
      id,
      status: 'deleted',
      duplicate: true,
      fileRestored: false,
    });
    expect(await statusOf(id)).toBe('deleted');
    expect(await processingJobs()).toEqual([]);
  });

  it('revives that tombstone when the bytes come through the API', async () => {
    const bytes = syntheticPdf('failed, tombstoned, uploaded again');
    const id = await failedDocument(bytes);
    const ingestion = await heldIngestion(bytes, 'api');
    await harness.database.db
      .update(documents)
      .set({ status: 'deleted', originalName: '', error: null })
      .where(eq(documents.id, id));
    ingestion.release();

    expect(await ingestion.result).toMatchObject({ id, status: 'received', duplicate: false });
    expect(await harness.database.db.select().from(documents)).toMatchObject([
      { id, status: 'received', originalName: 'again.pdf', source: 'api' },
    ]);
    expect(await processingJobs()).toHaveLength(1);
  });
});
