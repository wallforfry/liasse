import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jobs } from '../db/schema/jobs.ts';
import { waitUntil } from '../testing/async.ts';
import { enqueue } from './enqueue.ts';
import { PermanentJobError } from './errors.ts';
import { createHandlerRegistry, handle } from './handlers.ts';
import { defineJobKind, type TerminalFailure } from './kinds.ts';
import { jobById, labelJob } from './kinds.test-helper.ts';
import { recoverStaleJobs, terminalFailureHooks } from './store.ts';
import { createWorkersHarness, type WorkersHarness } from './workers.test-helper.ts';

describe('the terminal failure of a job', () => {
  let harness: WorkersHarness;
  const seen: TerminalFailure[] = [];
  let failHook = false;

  // A kind that says what its terminal failure means. The hook writes in the transaction
  // that fails the job: what it writes is undone with the failure when it throws.
  const watchedJob = defineJobKind({
    name: 'test_watched',
    schema: z.object({ label: z.string().min(1) }),
    maxAttempts: 2,
    onTerminalFailure: async (tx, failure) => {
      seen.push(failure);
      await enqueue(tx, { kind: labelJob, payload: { label: 'written by the hook' } });
      if (failHook) throw new Error('the hook failed');
    },
  });

  const queue = (label: string) =>
    enqueue(harness.database.db, { kind: watchedJob, payload: { label } });

  const markers = async () =>
    (await harness.database.db.select().from(jobs).where(eq(jobs.kind, labelJob.name))).length;

  beforeAll(async () => {
    harness = await createWorkersHarness();
  });

  afterEach(async () => {
    await harness.reset();
    seen.length = 0;
    failHook = false;
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('runs the hook of the kind once, when the last attempt fails, and not before', async () => {
    const id = await queue('failing');
    await harness.start({
      handlers: [handle(watchedJob, () => Promise.reject(new Error('always')))],
    });
    await waitUntil(async () => (await jobById(harness.database.db, id)).status === 'failed');
    expect(seen).toEqual([{ jobId: id, payload: { label: 'failing' }, cause: 'error' }]);
    expect(await markers()).toBe(1);
  });

  it('runs it at the first attempt for a permanent failure', async () => {
    const id = await queue('permanent');
    await harness.start({
      handlers: [handle(watchedJob, () => Promise.reject(new PermanentJobError('no')))],
    });
    await waitUntil(async () => (await jobById(harness.database.db, id)).status === 'failed');
    expect(seen).toEqual([{ jobId: id, payload: { label: 'permanent' }, cause: 'error' }]);
    expect((await jobById(harness.database.db, id)).attempts).toBe(1);
  });

  it('runs it with the stored payload when that payload does not match the schema', async () => {
    const [row] = await harness.database.db
      .insert(jobs)
      .values({ kind: watchedJob.name, payload: { label: 42 } })
      .returning({ id: jobs.id });
    await harness.start({ handlers: [handle(watchedJob, () => Promise.resolve())] });
    await waitUntil(
      async () => (await jobById(harness.database.db, row?.id ?? '')).status === 'failed',
    );
    expect(seen).toEqual([{ jobId: row?.id, payload: { label: 42 }, cause: 'error' }]);
  });

  const runningOnLastAttempt = async (label: string, attempts: number): Promise<string> => {
    const id = await queue(label);
    await harness.database.db
      .update(jobs)
      .set({ status: 'running', attempts, lockedAt: sql`now() - interval '10 minutes'` })
      .where(eq(jobs.id, id));
    return id;
  };

  const hooks = () =>
    terminalFailureHooks(createHandlerRegistry([handle(watchedJob, () => Promise.resolve())]));

  it('runs it when the recovery of stale locks fails a job that used every attempt', async () => {
    const last = await runningOnLastAttempt('last', 2);
    const early = await runningOnLastAttempt('early', 1);
    expect(await recoverStaleJobs(harness.database.db, 60_000, hooks())).toBe(2);
    expect((await jobById(harness.database.db, last)).status).toBe('failed');
    expect((await jobById(harness.database.db, early)).status).toBe('queued');
    expect(seen).toEqual([{ jobId: last, payload: { label: 'last' }, cause: 'stale' }]);
    expect(await markers()).toBe(1);
  });

  it('leaves the job running, and nothing of the hook, when the hook throws', async () => {
    failHook = true;
    const id = await runningOnLastAttempt('hook fails', 2);
    await expect(recoverStaleJobs(harness.database.db, 60_000, hooks())).rejects.toThrow(
      'the hook failed',
    );
    expect((await jobById(harness.database.db, id)).status).toBe('running');
    expect(await markers()).toBe(0);
  });

  it('runs it from the recovery the workers run by themselves', async () => {
    const id = await runningOnLastAttempt('recovered by the workers', 2);
    await harness.start({
      handlers: [handle(watchedJob, () => Promise.resolve())],
      visibilityTimeoutMs: 60_000,
    });
    await waitUntil(async () => (await jobById(harness.database.db, id)).status === 'failed');
    expect(seen).toEqual([
      { jobId: id, payload: { label: 'recovered by the workers' }, cause: 'stale' },
    ]);
  });

  it('runs no hook for a kind that has none', async () => {
    const [row] = await harness.database.db
      .insert(jobs)
      .values({
        kind: labelJob.name,
        payload: { label: 'plain' },
        status: 'running',
        attempts: 3,
        lockedAt: sql`now() - interval '10 minutes'`,
      })
      .returning({ id: jobs.id });
    expect(await recoverStaleJobs(harness.database.db, 60_000, hooks())).toBe(1);
    expect((await jobById(harness.database.db, row?.id ?? '')).status).toBe('failed');
    expect(seen).toEqual([]);
  });
});
