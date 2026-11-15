import type { JobStatus } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { insertSyntheticDocument, type NewDocumentRow } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { requeueHindsightForgets } from './forget-sweep.ts';
import { enqueueHindsightSync } from './sync-job.ts';

const HELD = new Date('2026-01-01T00:00:00Z');

describe('requeueHindsightForgets', () => {
  let database: TestDatabase;

  const document = async (overrides: Partial<NewDocumentRow> = {}): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, {
      status: 'indexed',
      hindsightHeldSince: HELD,
      ...overrides,
    });
    return id;
  };

  const tombstone = async (overrides: Partial<NewDocumentRow> = {}): Promise<string> => {
    const id = await document(overrides);
    await deleteDocument({ db: database.db }, id);
    return id;
  };

  const syncJobs = async (status?: JobStatus) =>
    (await database.db.select().from(jobs).orderBy(jobs.createdAt, jobs.id))
      .filter(({ kind }) => kind === 'hindsight_sync')
      .filter((job) => status === undefined || job.status === status);

  const sweep = (limit?: number) =>
    requeueHindsightForgets({ db: database.db }, limit === undefined ? {} : { limit });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.db.delete(jobs);
    await database.db.delete(documents);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('queues a sync for a tombstone and for a private document the bank may hold', async () => {
    const deleted = await tombstone();
    const hidden = await document({ private: true, hindsightHeldSince: new Date('2026-01-02') });
    expect(await sweep()).toBe(2);
    expect(await syncJobs()).toMatchObject([
      { payload: { documentId: deleted }, status: 'queued' },
      { payload: { documentId: hidden }, status: 'queued' },
    ]);
  });

  it('leaves the documents the bank holds nothing of', async () => {
    await tombstone({ hindsightHeldSince: null });
    await document({ private: true, hindsightHeldSince: null });
    expect(await sweep()).toBe(0);
    expect(await syncJobs()).toEqual([]);
  });

  it('leaves a live document that is not private, whose facts may stay', async () => {
    await document();
    expect(await sweep()).toBe(0);
  });

  it.each(['queued', 'running'] as const)('leaves a document whose sync is %s', async (status) => {
    const id = await tombstone();
    const jobId = await enqueueHindsightSync(database.db, id);
    await database.db.update(jobs).set({ status }).where(eq(jobs.id, jobId));
    expect(await sweep()).toBe(0);
    expect(await syncJobs()).toHaveLength(1);
  });

  it.each(['failed', 'succeeded'] as const)(
    'queues again a document whose sync %s',
    async (status) => {
      const id = await tombstone();
      const jobId = await enqueueHindsightSync(database.db, id);
      await database.db.update(jobs).set({ status }).where(eq(jobs.id, jobId));
      expect(await sweep()).toBe(1);
      expect(await syncJobs('queued')).toMatchObject([{ payload: { documentId: id } }]);
    },
  );

  it('is not held back by the sync of another document or by a job of another kind', async () => {
    const id = await tombstone();
    const other = await document();
    await enqueueHindsightSync(database.db, other);
    expect(await sweep()).toBe(1);
    expect(await syncJobs()).toMatchObject([
      { payload: { documentId: other } },
      { payload: { documentId: id } },
    ]);
  });

  it('queues at most the limit, the longest held first, and the rest at the next call', async () => {
    const later = await tombstone({ hindsightHeldSince: new Date('2026-03-01') });
    const first = await tombstone({ hindsightHeldSince: new Date('2026-01-01') });
    const second = await tombstone({ hindsightHeldSince: new Date('2026-02-01') });
    expect(await sweep(2)).toBe(2);
    expect((await syncJobs()).map(({ payload }) => payload)).toEqual([
      { documentId: first },
      { documentId: second },
    ]);
    expect(await sweep(2)).toBe(1);
    expect((await syncJobs()).at(-1)?.payload).toEqual({ documentId: later });
    expect(await sweep()).toBe(0);
  });
});
