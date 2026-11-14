import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import type { JobStatus } from '../domain/enums.ts';
import { storageKeyOf } from '../storage/key.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { deleteDocument } from './delete-document.ts';
import { createDeleteFileHandler } from './delete-file-job.ts';
import { requeueFileDeletions } from './file-deletion-sweep.ts';
import { createIngestHarness, type IngestHarness } from './harness.test-helper.ts';
import { ingestFile } from './ingest-file.ts';

const keyOf = (bytes: Uint8Array) => storageKeyOf(createHash('sha256').update(bytes).digest('hex'));

describe('requeueFileDeletions', () => {
  let harness: IngestHarness;

  const deleted = async (label: string): Promise<string> => {
    const { id } = await ingestFile(harness.deps, {
      bytes: syntheticPdf(label),
      filename: `${label}.pdf`,
      source: 'api',
    });
    await deleteDocument(harness.deps, id);
    return id;
  };

  const deletionJobs = (status?: JobStatus) =>
    harness.database.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.kind, 'delete_file'),
          status === undefined ? undefined : eq(jobs.status, status),
        ),
      );

  const settleJobs = (status: JobStatus) =>
    harness.database.db.update(jobs).set({ status }).where(eq(jobs.kind, 'delete_file'));

  const runHandler = (documentId: string): Promise<void> =>
    createDeleteFileHandler({ db: harness.database.db, storage: harness.storage }).run(
      { documentId },
      { signal: new AbortController().signal, attempt: 1 },
    );

  const sweep = (limit?: number) =>
    requeueFileDeletions({ db: harness.database.db }, limit === undefined ? {} : { limit });

  beforeAll(async () => {
    harness = await createIngestHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('queues the removal again for a tombstone whose job gave up', async () => {
    const id = await deleted('gave up');
    await settleJobs('failed');
    expect(await sweep()).toBe(1);
    expect(await deletionJobs('queued')).toMatchObject([{ payload: { documentId: id } }]);
    expect(await deletionJobs()).toHaveLength(2);
  });

  it('queues the removal again for a tombstone whose job is gone', async () => {
    const id = await deleted('job lost');
    await harness.database.db.delete(jobs);
    expect(await sweep()).toBe(1);
    expect(await deletionJobs()).toMatchObject([{ payload: { documentId: id }, status: 'queued' }]);
  });

  it.each(['queued', 'running'] as const)(
    'leaves a tombstone whose removal is %s, and is a no-op when run twice',
    async (status) => {
      await deleted('in progress');
      await settleJobs(status);
      expect(await sweep()).toBe(0);
      expect(await sweep()).toBe(0);
      expect(await deletionJobs()).toHaveLength(1);
    },
  );

  it('does not queue twice what it queued', async () => {
    await deleted('swept twice');
    await settleJobs('failed');
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    expect(await deletionJobs('queued')).toHaveLength(1);
  });

  it('leaves a tombstone whose file was removed, and a document that is not deleted', async () => {
    const bytes = syntheticPdf('removed');
    const { id } = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    await ingestFile(harness.deps, {
      bytes: syntheticPdf('live'),
      filename: 'live.pdf',
      source: 'api',
    });
    await deleteDocument(harness.deps, id);
    await runHandler(id);
    await settleJobs('succeeded');
    expect(await harness.storage.exists(keyOf(bytes))).toBe(false);
    const [tombstone] = await harness.database.db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    expect(tombstone?.fileDeletedAt).toBeInstanceOf(Date);
    expect(await sweep()).toBe(0);
  });

  it('still owes the removal when the storage refused it', async () => {
    const id = await deleted('refused');
    const failing = createDeleteFileHandler({
      db: harness.database.db,
      storage: {
        ...harness.storage,
        delete: () => Promise.reject(new Error('synthetic storage outage')),
      },
    });
    await expect(
      failing.run({ documentId: id }, { signal: new AbortController().signal, attempt: 1 }),
    ).rejects.toThrow('synthetic storage outage');
    await settleJobs('failed');
    expect(await sweep()).toBe(1);
  });

  it('owes the removal again after the document was revived and deleted once more', async () => {
    const bytes = syntheticPdf('deleted twice');
    const { id } = await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    await deleteDocument(harness.deps, id);
    await runHandler(id);
    await ingestFile(harness.deps, { bytes, filename: 'a.pdf', source: 'api' });
    await deleteDocument(harness.deps, id);
    await harness.database.db.delete(jobs);
    expect(await sweep()).toBe(1);
  });

  it('queues at most its limit at a time, oldest deletion first', async () => {
    const first = await deleted('first');
    const second = await deleted('second');
    const third = await deleted('third');
    await harness.database.db.delete(jobs);
    expect(await sweep(2)).toBe(2);
    const queued = await deletionJobs('queued');
    expect(queued.map(({ payload }) => payload.documentId).sort()).toEqual([first, second].sort());
    expect(await sweep(2)).toBe(1);
    expect(await deletionJobs('queued')).toHaveLength(3);
    expect((await deletionJobs('queued')).some(({ payload }) => payload.documentId === third)).toBe(
      true,
    );
  });
});
