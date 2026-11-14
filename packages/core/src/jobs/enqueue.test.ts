import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { enqueue } from './enqueue.ts';
import { JobPayloadError } from './errors.ts';
import { jobById, labelJob, singleAttemptJob } from './kinds.test-helper.ts';

describe('enqueue', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.db.delete(jobs);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('queues a job that is due at once', async () => {
    const id = await enqueue(database.db, { kind: labelJob, payload: { label: 'synthetic' } });
    const job = await jobById(database.db, id);
    expect(id).toMatch(/^job_/);
    expect(job).toMatchObject({
      kind: 'test_label',
      payload: { label: 'synthetic' },
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      lockedAt: null,
      lastError: null,
    });
    expect(job.runAfter.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('delays a job until runAfter', async () => {
    const runAfter = new Date('2040-01-01T00:00:00Z');
    const id = await enqueue(database.db, {
      kind: labelJob,
      payload: { label: 'synthetic' },
      runAfter,
    });
    expect((await jobById(database.db, id)).runAfter).toEqual(runAfter);
  });

  it('takes max_attempts from the kind', async () => {
    const id = await enqueue(database.db, {
      kind: singleAttemptJob,
      payload: { label: 'synthetic' },
    });
    expect((await jobById(database.db, id)).maxAttempts).toBe(1);
  });

  it('refuses a payload that does not match the schema of its kind', async () => {
    await expect(
      enqueue(database.db, { kind: labelJob, payload: { label: '' } }),
    ).rejects.toBeInstanceOf(JobPayloadError);
    expect(await database.db.select().from(jobs)).toEqual([]);
  });

  it('keeps the rejected payload out of the error', async () => {
    const stray = { label: '', note: 'synthetic-secret-content' };
    await expect(enqueue(database.db, { kind: labelJob, payload: stray })).rejects.toThrow(
      /^The payload of a test_label job does not match its schema \(label: [^)]*\)$/,
    );
  });

  it('commits or rolls back with the transaction it is given', async () => {
    await expect(
      database.db.transaction(async (tx) => {
        await enqueue(tx, { kind: labelJob, payload: { label: 'rolled back' } });
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await database.db.select().from(jobs)).toEqual([]);

    const id = await database.db.transaction((tx) =>
      enqueue(tx, { kind: labelJob, payload: { label: 'committed' } }),
    );
    expect((await jobById(database.db, id)).payload).toEqual({ label: 'committed' });
  });
});
