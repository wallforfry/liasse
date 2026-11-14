import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { enqueue } from './enqueue.ts';
import {
  DuplicateJobHandlerError,
  JobLockLostError,
  PermanentJobError,
  WorkersStoppingError,
} from './errors.ts';
import type { JobFailure } from './execution.ts';
import { handle, type JobContext } from './handlers.ts';
import { jobById, labelJob, otherJob } from './kinds.test-helper.ts';
import { startWorkers, type Workers, type WorkersOptions } from './workers.ts';

type LabelContext = JobContext<{ readonly label: string }>;

const aborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    });
  });

describe('workers', () => {
  let database: TestDatabase;
  const started: Workers[] = [];

  const start = async (
    options: Omit<WorkersOptions, 'db' | 'concurrency'> & { readonly concurrency?: number },
  ): Promise<Workers> => {
    const workers = await startWorkers({
      db: database.db,
      concurrency: 2,
      pollIntervalMs: 20,
      maxPollIntervalMs: 40,
      retry: { baseMs: 10, maxMs: 20 },
      ...options,
    });
    started.push(workers);
    return workers;
  };

  const queue = (label: string): Promise<string> =>
    enqueue(database.db, { kind: labelJob, payload: { label } });

  const statusOf = async (id: string): Promise<string> => (await jobById(database.db, id)).status;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await Promise.all(
      started.splice(0).map((workers) => workers.stop({ timeoutMs: 0, abortGraceMs: 500 })),
    );
    await database.db.delete(jobs);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('runs a queued job with its payload, its attempt and a live signal', async () => {
    const seen: LabelContext[] = [];
    await start({
      handlers: [
        handle(labelJob, (context) => {
          seen.push(context);
          return Promise.resolve();
        }),
      ],
    });
    const id = await queue('synthetic');
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ payload: { label: 'synthetic' }, attempt: 1 });
    expect(seen[0]?.signal.aborted).toBe(false);
    expect(await jobById(database.db, id)).toMatchObject({ attempts: 1, lockedAt: null });
  });

  it('runs no job twice under several concurrent workers', async () => {
    const runs: string[] = [];
    const handlers = [
      handle(labelJob, async ({ payload }) => {
        runs.push(payload.label);
        await sleep(2);
      }),
    ];
    const labels = Array.from({ length: 80 }, (_, index) => `job-${String(index)}`);
    await Promise.all(labels.map(queue));
    await Promise.all(Array.from({ length: 6 }, () => start({ handlers, concurrency: 4 })));
    await waitUntil(async () => {
      const rows = await database.db.select({ status: jobs.status }).from(jobs);
      return rows.every(({ status }) => status === 'succeeded');
    }, 10_000);
    expect([...runs].sort()).toEqual([...labels].sort());
    const attempts = await database.db.select({ attempts: jobs.attempts }).from(jobs);
    expect(attempts.every((row) => row.attempts === 1)).toBe(true);
  });

  it('retries a throwing handler, then fails the job for good', async () => {
    const attempts: number[] = [];
    const failures: JobFailure[] = [];
    await start({
      handlers: [
        handle(labelJob, ({ attempt }) => {
          attempts.push(attempt);
          return Promise.reject(new Error('synthetic failure'));
        }),
      ],
      onJobFailed: (failure) => failures.push(failure),
    });
    const id = await queue('always fails');
    await waitUntil(async () => (await statusOf(id)) === 'failed');
    expect(attempts).toEqual([1, 2, 3]);
    expect(await jobById(database.db, id)).toMatchObject({
      attempts: 3,
      lockedAt: null,
      lastError: 'Error: synthetic failure',
    });
    expect(failures.map(({ willRetry }) => willRetry)).toEqual([true, true, false]);
    expect(failures[0]?.job).toMatchObject({ id, kind: 'test_label', attempt: 1 });
    await sleep(100);
    expect(attempts).toHaveLength(3);
  });

  it('succeeds on a later attempt', async () => {
    await start({
      handlers: [
        handle(labelJob, ({ attempt }) =>
          attempt === 1 ? Promise.reject(new Error('synthetic failure')) : Promise.resolve(),
        ),
      ],
    });
    const id = await queue('fails once');
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
    expect((await jobById(database.db, id)).attempts).toBe(2);
  });

  it('delays a retry by the backoff of the failed attempt', async () => {
    let runs = 0;
    await start({
      retry: { baseMs: 60_000, maxMs: 600_000 },
      handlers: [
        handle(labelJob, () => {
          runs += 1;
          return Promise.reject(new Error('synthetic failure'));
        }),
      ],
    });
    const id = await queue('backs off');
    await waitUntil(async () => (await jobById(database.db, id)).lastError !== null);
    const job = await jobById(database.db, id);
    expect(job.status).toBe('queued');
    expect(job.runAfter.getTime() - Date.now()).toBeGreaterThan(50_000);
    await sleep(150);
    expect(runs).toBe(1);
  });

  it('does not retry a permanent failure', async () => {
    let runs = 0;
    await start({
      handlers: [
        handle(labelJob, () => {
          runs += 1;
          return Promise.reject(new PermanentJobError('synthetic permanent failure'));
        }),
      ],
    });
    const id = await queue('permanent');
    await waitUntil(async () => (await statusOf(id)) === 'failed');
    expect(runs).toBe(1);
    expect(await jobById(database.db, id)).toMatchObject({
      attempts: 1,
      lastError: 'PermanentJobError: synthetic permanent failure',
    });
  });

  it('fails a stored payload that does not match the schema without calling the handler', async () => {
    let runs = 0;
    await start({
      handlers: [
        handle(labelJob, () => {
          runs += 1;
          return Promise.resolve();
        }),
      ],
    });
    const [job] = await database.db
      .insert(jobs)
      .values({ kind: labelJob.name, payload: { label: 42 } })
      .returning();
    await waitUntil(async () => (await statusOf(job?.id ?? '')) === 'failed');
    expect(runs).toBe(0);
    expect((await jobById(database.db, job?.id ?? '')).lastError).toMatch(/^JobPayloadError: /);
  });

  it('leaves a kind without handler in the queue', async () => {
    await start({ handlers: [handle(otherJob, () => Promise.resolve())] });
    const id = await queue('nobody handles this');
    const handled = await enqueue(database.db, { kind: otherJob, payload: { label: 'handled' } });
    await waitUntil(async () => (await statusOf(handled)) === 'succeeded');
    expect(await jobById(database.db, id)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('refuses two handlers for one kind', async () => {
    const handler = handle(labelJob, () => Promise.resolve());
    await expect(start({ handlers: [handler, handler] })).rejects.toBeInstanceOf(
      DuplicateJobHandlerError,
    );
  });

  it('never runs more jobs at once than its concurrency, all kinds together', async () => {
    let active = 0;
    let peak = 0;
    const track = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await sleep(40);
      active -= 1;
    };
    await start({
      concurrency: 2,
      handlers: [handle(labelJob, track), handle(otherJob, track)],
    });
    const ids = await Promise.all([
      ...['a', 'b', 'c'].map(queue),
      ...['x', 'y', 'z'].map((label) =>
        enqueue(database.db, { kind: otherJob, payload: { label } }),
      ),
    ]);
    await waitUntil(async () =>
      (await Promise.all(ids.map(statusOf))).every((status) => status === 'succeeded'),
    );
    expect(peak).toBe(2);
  });

  it('limits one kind to its own concurrency while other kinds run beside it', async () => {
    const active = { limited: 0, free: 0 };
    const peak = { limited: 0, together: 0 };
    const track = (kind: 'limited' | 'free') => async (): Promise<void> => {
      active[kind] += 1;
      peak.limited = Math.max(peak.limited, active.limited);
      peak.together = Math.max(peak.together, active.limited + active.free);
      await sleep(40);
      active[kind] -= 1;
    };
    await Promise.all(['a', 'b', 'c', 'd'].map(queue));
    await Promise.all(
      ['x', 'y'].map((label) => enqueue(database.db, { kind: otherJob, payload: { label } })),
    );
    await start({
      concurrency: 3,
      perKindConcurrency: { [labelJob.name]: 1 },
      handlers: [handle(labelJob, track('limited')), handle(otherJob, track('free'))],
    });
    await waitUntil(async () => {
      const rows = await database.db.select({ status: jobs.status }).from(jobs);
      return rows.every(({ status }) => status === 'succeeded');
    });
    expect(peak.limited).toBe(1);
    expect(peak.together).toBeGreaterThan(1);
  });

  it('takes back a job whose worker died, after the visibility timeout', async () => {
    const attempts: number[] = [];
    const [orphan] = await database.db
      .insert(jobs)
      .values({
        kind: labelJob.name,
        payload: { label: 'orphan' },
        status: 'running',
        attempts: 1,
        lockedAt: sql`now() - interval '1 hour'`,
      })
      .returning();
    await start({
      visibilityTimeoutMs: 200,
      handlers: [
        handle(labelJob, ({ attempt }) => {
          attempts.push(attempt);
          return Promise.resolve();
        }),
      ],
    });
    await waitUntil(async () => (await statusOf(orphan?.id ?? '')) === 'succeeded');
    expect(attempts).toEqual([2]);
  });

  it('keeps a job that outlives the visibility timeout while its worker is alive', async () => {
    let runs = 0;
    const handlers = [
      handle(labelJob, async () => {
        runs += 1;
        await sleep(2000);
      }),
    ];
    await start({ visibilityTimeoutMs: 600, handlers });
    await start({ visibilityTimeoutMs: 600, handlers });
    const id = await queue('long');
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
    expect(runs).toBe(1);
    expect((await jobById(database.db, id)).attempts).toBe(1);
  });

  it('aborts a handler whose job was taken over', async () => {
    const reasons: unknown[] = [];
    await start({
      visibilityTimeoutMs: 150,
      handlers: [
        handle(labelJob, async ({ signal }) => {
          await aborted(signal);
          reasons.push(signal.reason);
        }),
      ],
    });
    const id = await queue('taken over');
    await waitUntil(async () => (await statusOf(id)) === 'running');
    // What another worker's claim does to the row; its lock is dated ahead so that it
    // does not expire in turn during the test.
    await database.db
      .update(jobs)
      .set({ attempts: sql`${jobs.attempts} + 1`, lockedAt: sql`now() + interval '1 hour'` })
      .where(eq(jobs.id, id));
    await waitUntil(() => reasons.length === 1);
    expect(reasons[0]).toBeInstanceOf(JobLockLostError);
    await sleep(100);
    expect(await jobById(database.db, id)).toMatchObject({ status: 'running', attempts: 2 });
  });

  it('wakes up for a new job without waiting for the next poll', async () => {
    await start({
      pollIntervalMs: 60_000,
      maxPollIntervalMs: 60_000,
      handlers: [handle(labelJob, () => Promise.resolve())],
    });
    await sleep(200);
    const id = await queue('notified');
    await waitUntil(async () => (await statusOf(id)) === 'succeeded', 2000);
  });

  it('drains in-flight jobs on stop and claims nothing more', async () => {
    const entered = createGate();
    const workers = await start({
      handlers: [
        handle(labelJob, async () => {
          entered.open();
          await sleep(200);
        }),
      ],
    });
    const id = await queue('in flight');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 5000 })).toEqual({ aborted: [], abandoned: [] });
    expect(await statusOf(id)).toBe('succeeded');
    const late = await queue('after stop');
    await sleep(150);
    expect(await jobById(database.db, late)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('aborts a handler past the stop deadline and gives its job back uncounted', async () => {
    const entered = createGate();
    const reasons: unknown[] = [];
    const workers = await start({
      handlers: [
        handle(labelJob, async ({ signal }) => {
          entered.open();
          await aborted(signal);
          reasons.push(signal.reason);
          throw new Error('synthetic abort');
        }),
      ],
    });
    const id = await queue('interrupted');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 30, abortGraceMs: 2000 })).toEqual({
      aborted: [id],
      abandoned: [],
    });
    expect(reasons[0]).toBeInstanceOf(WorkersStoppingError);
    expect(await jobById(database.db, id)).toMatchObject({
      status: 'queued',
      attempts: 0,
      lockedAt: null,
      lastError: null,
    });
  });

  it('abandons a handler that ignores the abort, without releasing its job', async () => {
    const entered = createGate();
    const finish = createGate();
    const workers = await start({
      handlers: [
        handle(labelJob, async () => {
          entered.open();
          await finish.opened;
        }),
      ],
    });
    const id = await queue('deaf');
    await entered.opened;
    expect(await workers.stop({ timeoutMs: 20, abortGraceMs: 40 })).toEqual({
      aborted: [id],
      abandoned: [id],
    });
    expect(await statusOf(id)).toBe('running');
    finish.open();
    await waitUntil(async () => (await statusOf(id)) === 'succeeded');
  });

  it('reports a database it cannot reach and still stops', async () => {
    const unreachable = createDb(database.url.replace(/\/[^/]+$/, '/liasse_test_never_created'));
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
