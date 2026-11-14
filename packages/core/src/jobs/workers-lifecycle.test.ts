import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { JobLockLostError, WorkersStoppingError } from './errors.ts';
import { handle } from './handlers.ts';
import { jobById, labelJob } from './kinds.test-helper.ts';
import { recoverStaleJobs } from './store.ts';
import { aborted, createWorkersHarness, type WorkersHarness } from './workers.test-helper.ts';
import { startWorkers } from './workers.ts';

describe('workers: locks, wake-up and stop', () => {
  let harness: WorkersHarness;

  beforeAll(async () => {
    harness = await createWorkersHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('takes back a job whose worker died, after the visibility timeout', async () => {
    const attempts: number[] = [];
    const [orphan] = await harness.database.db
      .insert(jobs)
      .values({
        kind: labelJob.name,
        payload: { label: 'orphan' },
        status: 'running',
        attempts: 1,
        lockedAt: sql`now() - interval '1 hour'`,
      })
      .returning();
    await harness.start({
      visibilityTimeoutMs: 200,
      handlers: [
        handle(labelJob, ({ attempt }) => {
          attempts.push(attempt);
          return Promise.resolve();
        }),
      ],
    });
    await waitUntil(async () => (await harness.statusOf(orphan?.id ?? '')) === 'succeeded');
    expect(attempts).toEqual([2]);
  });

  it('keeps a job that outlives the visibility timeout while its worker is alive', async () => {
    const visibilityTimeoutMs = 3000;
    const finish = createGate();
    let runs = 0;
    const handlers = [
      handle(labelJob, async () => {
        runs += 1;
        await finish.opened;
      }),
    ];
    await harness.start({ visibilityTimeoutMs, handlers });
    await harness.start({ visibilityTimeoutMs, handlers });
    const id = await harness.queue('long');
    await waitUntil(async () => (await harness.statusOf(id)) === 'running', 60_000);
    const claimedAt = (await jobById(harness.database.db, id)).lockedAt?.getTime() ?? 0;
    // The handler is held until the database shows renewals spanning twice the
    // timeout: by then a lock left alone would have been stale through a whole
    // recovery period of both workers. A second run ends the wait at once.
    await waitUntil(async () => {
      const renewedAt = (await jobById(harness.database.db, id)).lockedAt?.getTime() ?? 0;
      return runs > 1 || renewedAt - claimedAt >= 2 * visibilityTimeoutMs;
    }, 120_000);
    finish.open();
    await waitUntil(async () => (await harness.statusOf(id)) === 'succeeded', 60_000);
    expect(runs).toBe(1);
    expect((await jobById(harness.database.db, id)).attempts).toBe(1);
  }, 240_000);

  it('aborts a handler whose job was taken over', async () => {
    const reasons: unknown[] = [];
    await harness.start({
      visibilityTimeoutMs: 150,
      handlers: [
        handle(labelJob, async ({ signal }) => {
          await aborted(signal);
          reasons.push(signal.reason);
        }),
      ],
    });
    const id = await harness.queue('taken over');
    await waitUntil(async () => (await harness.statusOf(id)) === 'running');
    // What another worker's claim does to the row; its lock is dated ahead so that it
    // does not expire in turn during the test.
    await harness.database.db
      .update(jobs)
      .set({ attempts: sql`${jobs.attempts} + 1`, lockedAt: sql`now() + interval '1 hour'` })
      .where(eq(jobs.id, id));
    await waitUntil(() => reasons.length === 1);
    expect(reasons[0]).toBeInstanceOf(JobLockLostError);
    await sleep(100);
    expect(await jobById(harness.database.db, id)).toMatchObject({
      status: 'running',
      attempts: 2,
    });
  });

  it('wakes up for a new job without waiting for the next poll', async () => {
    // Polling is out of the picture for the length of the test, so only a notification
    // can start a job. Several jobs in a row, because the very first claim of a
    // dispatcher, and the one that follows a finished job, need no notification.
    const pollIntervalMs = 3_600_000;
    await harness.start({
      pollIntervalMs,
      maxPollIntervalMs: pollIntervalMs,
      handlers: [handle(labelJob, () => Promise.resolve())],
    });
    for (const label of ['first', 'second', 'third', 'fourth', 'fifth']) {
      const id = await harness.queue(label);
      await waitUntil(async () => (await harness.statusOf(id)) === 'succeeded', 60_000);
    }
  }, 360_000);

  it('drains in-flight jobs on stop and claims nothing more', async () => {
    const entered = createGate();
    const workers = await harness.start({
      handlers: [
        handle(labelJob, async () => {
          entered.open();
          await sleep(200);
        }),
      ],
    });
    const id = await harness.queue('in flight');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 5000 })).toEqual({ aborted: [], abandoned: [] });
    expect(await harness.statusOf(id)).toBe('succeeded');
    const late = await harness.queue('after stop');
    await sleep(150);
    expect(await jobById(harness.database.db, late)).toMatchObject({
      status: 'queued',
      attempts: 0,
    });
  });

  it('aborts a handler past the stop deadline and gives its job back uncounted', async () => {
    const entered = createGate();
    const reasons: unknown[] = [];
    const workers = await harness.start({
      handlers: [
        handle(labelJob, async ({ signal }) => {
          entered.open();
          await aborted(signal);
          reasons.push(signal.reason);
          throw new Error('synthetic abort');
        }),
      ],
    });
    const id = await harness.queue('interrupted');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 30, abortGraceMs: 2000 })).toEqual({
      aborted: [id],
      abandoned: [],
    });
    expect(reasons[0]).toBeInstanceOf(WorkersStoppingError);
    expect(await jobById(harness.database.db, id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      lockedAt: null,
      lastError: null,
    });
  });

  it('abandons a handler that ignores the abort, without releasing its job', async () => {
    const entered = createGate();
    const finish = createGate();
    const workers = await harness.start({
      handlers: [
        handle(labelJob, async () => {
          entered.open();
          await finish.opened;
        }),
      ],
    });
    const id = await harness.queue('deaf');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 20, abortGraceMs: 40 })).toEqual({
      aborted: [id],
      abandoned: [id],
    });
    expect(await harness.statusOf(id)).toBe('running');
    finish.open();
    await waitUntil(async () => (await harness.statusOf(id)) === 'succeeded');
  });

  it('stops renewing the lock of an abandoned job, so that it is taken back', async () => {
    const entered = createGate();
    const finish = createGate();
    const workers = await harness.start({
      visibilityTimeoutMs: 300,
      handlers: [
        handle(labelJob, async () => {
          entered.open();
          await finish.opened;
        }),
      ],
    });
    const id = await harness.queue('abandoned');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 0, abortGraceMs: 20 })).toMatchObject({
      abandoned: [id],
    });
    await waitUntil(async () => (await recoverStaleJobs(harness.database.db, 300)) === 1, 15_000);
    expect(await jobById(harness.database.db, id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedAt: null,
    });
    finish.open();
  }, 30_000);

  it('tracks both executions of a job it lost and claimed again', async () => {
    const gates = [createGate(), createGate()];
    const attempts: number[] = [];
    const errors: unknown[] = [];
    const workers = await harness.start({
      onError: (error) => errors.push(error),
      handlers: [
        handle(labelJob, async ({ attempt }) => {
          attempts.push(attempt);
          await gates[attempt - 1]?.opened;
        }),
      ],
    });
    const id = await harness.queue('claimed twice');
    await waitUntil(() => attempts.length === 1);
    // What the stale-lock recovery does to a job whose worker went silent.
    await harness.database.db
      .update(jobs)
      .set({ status: 'queued', lockedAt: null })
      .where(eq(jobs.id, id));
    await waitUntil(() => attempts.length === 2);
    gates[0]?.open();
    await waitUntil(() => errors.some((error) => error instanceof JobLockLostError));

    // The first execution is over; the second one is still running and must be seen.
    expect(await workers.stop({ timeoutMs: 0, abortGraceMs: 20 })).toEqual({
      aborted: [id],
      abandoned: [id],
    });
    gates[1]?.open();
    await waitUntil(async () => (await harness.statusOf(id)) === 'succeeded');
  });

  it('reports a database it cannot reach and still stops', async () => {
    const unreachable = createDb(
      harness.database.url.replace(/\/[^/]+$/, '/liasse_test_never_created'),
    );
    const errors: unknown[] = [];
    const workers = await startWorkers({
      db: unreachable.db,
      concurrency: 1,
      pollIntervalMs: 10,
      handlers: [handle(labelJob, () => Promise.resolve())],
      onError: (error) => errors.push(error),
    });
    await waitUntil(() => errors.length >= 3);
    expect(await workers.stop({ timeoutMs: 0 })).toEqual({ aborted: [], abandoned: [] });
    await unreachable.close();
  });
});
