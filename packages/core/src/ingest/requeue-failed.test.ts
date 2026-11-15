import { MAX_WATCH_REQUEUES } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';
import { processDocumentJob } from './process-document-job.ts';
import { retryFailedDocument } from './requeue-failed.ts';

describe('retryFailedDocument', () => {
  let harness: IngestHarness;

  const db = () => harness.database.db;
  const documentRows = () => db().select().from(documents);
  const jobRows = () => db().select().from(jobs);

  const ingest = (text: string) =>
    ingestFile(harness.deps, { bytes: syntheticPdf(text), filename: 'a.pdf', source: 'watch' });

  const fail = async (id: string): Promise<void> => {
    await db()
      .update(documents)
      .set({ status: 'failed', error: 'model_provider_failed', watchRequeues: MAX_WATCH_REQUEUES })
      .where(eq(documents.id, id));
    await db().delete(jobs);
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

  it('queues a failed document from the start and gives the folder its tries back', async () => {
    const { id } = await ingest('failed once');
    await fail(id);
    expect(await retryFailedDocument(db(), id)).toBe('queued');
    expect(await documentRows()).toMatchObject([
      { id, status: 'received', error: null, watchRequeues: 0 },
    ]);
    expect(await jobRows()).toMatchObject([
      { kind: 'process_document', payload: { documentId: id }, status: 'queued' },
    ]);
  });

  it('leaves a document that did not fail as it is', async () => {
    const { id } = await ingest('still processing');
    expect(await retryFailedDocument(db(), id)).toBe('not_failed');
    expect(await documentRows()).toMatchObject([{ id, status: 'received' }]);
    expect(await jobRows()).toHaveLength(1);
  });

  it('waits for the job that failed the document to finish failing', async () => {
    const { id } = await ingest('failed, job not failed yet');
    await fail(id);
    await enqueue(db(), { kind: processDocumentJob, payload: { documentId: id } });
    for (const status of ['queued', 'running'] as const) {
      await db().update(jobs).set({ status });
      expect(await retryFailedDocument(db(), id), status).toBe('not_failed');
    }
    expect(await documentRows()).toMatchObject([{ id, status: 'failed' }]);
    await db().update(jobs).set({ status: 'failed' });
    expect(await retryFailedDocument(db(), id)).toBe('queued');
  });

  it('is not held back by the processing of another document', async () => {
    const { id } = await ingest('failed while another is processed');
    await fail(id);
    await ingest('another, still processing');
    await db().update(jobs).set({ status: 'running' });
    expect(await retryFailedDocument(db(), id)).toBe('queued');
  });

  it('finds no document for an unknown id or a deleted one', async () => {
    const { id } = await ingest('deleted after failing');
    await fail(id);
    await deleteDocument(harness.deps, id);
    await db().delete(jobs);
    expect(await retryFailedDocument(db(), id)).toBe('not_found');
    expect(await retryFailedDocument(db(), 'doc_01UNKNOWN')).toBe('not_found');
    expect(await jobRows()).toEqual([]);
  });
});
