import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { enqueue } from './enqueue.ts';
import {
  claimJob,
  completeJob,
  failJob,
  recoverStaleJobs,
  releaseJob,
  renewJobLock,
  retryJob,
  STALE_LOCK_ERROR,
} from './store.ts';
import { jobById, labelJob, otherJob } from './kinds.test-helper.ts';

const KINDS = [labelJob.name, otherJob.name];

describe('job store', () => {
  let database: TestDatabase;

  const queue = (label: string, runAfter?: Date): Promise<string> =>
    enqueue(database.db, {
      kind: labelJob,
      payload: { label },
      ...(runAfter === undefined ? {} : { runAfter }),
    });

  const claimed = async (): Promise<NonNullable<Awaited<ReturnType<typeof claimJob>>>> => {
    const job = await claimJob(database.db, KINDS);
    if (job === undefined) throw new Error('expected a job to claim');
    return job;
  };

  const ageLock = (id: string, seconds: number) =>
    database.db
      .update(jobs)
      .set({ lockedAt: sql`now() - make_interval(secs => ${seconds})` })
      .where(eq(jobs.id, id));

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.db.delete(jobs);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('claims a queued job, locks it and counts the attempt', async () => {
    const id = await queue('synthetic');
    expect(await claimJob(database.db, KINDS)).toEqual({
      id,
      kind: 'test_label',
      payload: { label: 'synthetic' },
      attempt: 1,
      maxAttempts: 3,
    });
    const job = await jobById(database.db, id);
    expect(job).toMatchObject({ status: 'running', attempts: 1 });
    expect(job.lockedAt).toBeInstanceOf(Date);
  });

  it('claims each job once', async () => {
    await queue('only');
    expect(await claimJob(database.db, KINDS)).toBeDefined();
    expect(await claimJob(database.db, KINDS)).toBeUndefined();
  });

  it('claims jobs in the order they are due', async () => {
    const later = await queue('later', new Date(Date.now() - 1000));
    const sooner = await queue('sooner', new Date(Date.now() - 60_000));
    expect((await claimed()).id).toBe(sooner);
    expect((await claimed()).id).toBe(later);
  });

  it('leaves a job that is not due yet', async () => {
    await queue('future', new Date(Date.now() + 60_000));
    expect(await claimJob(database.db, KINDS)).toBeUndefined();
  });

  it('claims only the kinds it is asked for', async () => {
    await queue('synthetic');
    expect(await claimJob(database.db, [otherJob.name])).toBeUndefined();
    expect(await claimJob(database.db, [])).toBeUndefined();
    expect(await claimJob(database.db, [labelJob.name])).toBeDefined();
  });

  it('skips a job locked by another transaction instead of waiting for it', async () => {
    const lockedId = await queue('locked', new Date(Date.now() - 60_000));
    const freeId = await queue('free');
    const rowLocked = createGate();
    const release = createGate();
    const holder = database.db.transaction(async (tx) => {
      await tx.select().from(jobs).where(eq(jobs.id, lockedId)).for('update');
      rowLocked.open();
      await release.opened;
    });
    await rowLocked.opened;
    // No deadline decides the outcome: either the claim returns, or Postgres itself
    // reports a session of this database waiting on a lock.
    let returned = false;
    const claim = claimJob(database.db, KINDS).finally(() => {
      returned = true;
    });
    await waitUntil(async () => {
      const [activity] = await database.db.execute<{ waiting: number }>(sql`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      return returned || (activity?.waiting ?? 0) > 0;
    }, 60_000);
    const skipped = returned;
    release.open();
    await holder;
    expect(skipped).toBe(true);
    expect(await claim).toMatchObject({ id: freeId });
  }, 90_000);

  it('writes a success, a retry and a failure back', async () => {
    await queue('succeeds');
    const succeeded = await claimed();
    expect(await completeJob(database.db, succeeded)).toBe(true);
    expect(await jobById(database.db, succeeded.id)).toMatchObject({
      status: 'succeeded',
      lockedAt: null,
    });

    await queue('retries');
    const retried = await claimed();
    expect(await retryJob(database.db, retried, 'synthetic failure', 60_000)).toBe(true);
    const queuedAgain = await jobById(database.db, retried.id);
    expect(queuedAgain).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedAt: null,
      lastError: 'synthetic failure',
    });
    const delayMs = queuedAgain.runAfter.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(50_000);
    expect(delayMs).toBeLessThan(70_000);
    expect(await claimJob(database.db, KINDS)).toBeUndefined();

    await queue('fails');
    const failed = await claimed();
    expect(await failJob(database.db, failed, 'synthetic failure')).toBe(true);
    expect(await jobById(database.db, failed.id)).toMatchObject({
      status: 'failed',
      lockedAt: null,
      lastError: 'synthetic failure',
    });
    expect(await claimJob(database.db, KINDS)).toBeUndefined();
  });

  it('releases a job without counting the attempt', async () => {
    await queue('released');
    const job = await claimed();
    expect(await releaseJob(database.db, job)).toBe(true);
    expect(await jobById(database.db, job.id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      lockedAt: null,
    });
    expect((await claimed()).attempt).toBe(1);
  });

  it('ignores every write of an execution that lost its job', async () => {
    const id = await queue('taken over');
    const stale = await claimed();
    await ageLock(id, 3600);
    expect(await recoverStaleJobs(database.db, 1000)).toBe(1);
    const current = await claimed();
    expect(current).toMatchObject({ id, attempt: 2 });

    expect(await completeJob(database.db, stale)).toBe(false);
    expect(await failJob(database.db, stale, 'late')).toBe(false);
    expect(await retryJob(database.db, stale, 'late', 0)).toBe(false);
    expect(await releaseJob(database.db, stale)).toBe(false);
    expect(await renewJobLock(database.db, stale)).toBe(false);
    expect(await jobById(database.db, id)).toMatchObject({
      status: 'running',
      attempts: 2,
      lastError: STALE_LOCK_ERROR,
    });
    expect(await completeJob(database.db, current)).toBe(true);
    expect(await completeJob(database.db, current)).toBe(false);
  });

  it('requeues a stale running job and leaves a fresh one alone', async () => {
    const staleId = await queue('stale', new Date(Date.now() - 60_000));
    const freshId = await queue('fresh');
    await claimed();
    await claimed();
    await ageLock(staleId, 120);
    expect(await recoverStaleJobs(database.db, 60_000)).toBe(1);
    expect(await jobById(database.db, staleId)).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedAt: null,
      lastError: STALE_LOCK_ERROR,
    });
    expect(await jobById(database.db, freshId)).toMatchObject({ status: 'running' });
  });

  it('renews a lock so the job is no longer stale', async () => {
    const id = await queue('renewed');
    const job = await claimed();
    await ageLock(id, 120);
    expect(await renewJobLock(database.db, job)).toBe(true);
    expect(await recoverStaleJobs(database.db, 60_000)).toBe(0);
    expect(await jobById(database.db, id)).toMatchObject({ status: 'running' });
  });

  it('fails a stale job that has no attempt left', async () => {
    const id = await queue('exhausted');
    await database.db.update(jobs).set({ attempts: 2 }).where(eq(jobs.id, id));
    await claimed();
    await ageLock(id, 120);
    expect(await recoverStaleJobs(database.db, 60_000)).toBe(1);
    expect(await jobById(database.db, id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: STALE_LOCK_ERROR,
    });
  });
});
