import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { createGate, sleep, waitUntil } from '../testing/async.ts';
import { enqueue } from './enqueue.ts';
import { DuplicateJobHandlerError, PermanentJobError } from './errors.ts';
import type { JobFailure } from './execution.ts';
import { handle, type JobContext } from './handlers.ts';
import { jobById, labelJob, otherJob } from './kinds.test-helper.ts';
import {
  createWorkersHarness,
  type StartOptions,
  type WorkersHarness,
} from './workers.test-helper.ts';

type LabelContext = JobContext<{ readonly label: string }>;

describe('workers: running, retrying and limiting jobs', () => {
  let harness: WorkersHarness;

  const start = (options: StartOptions) => harness.start(options);
  const queue = (label: string) => harness.queue(label);
  const statusOf = (id: string) => harness.statusOf(id);

  beforeAll(async () => {
    harness = await createWorkersHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
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
    expect(await jobById(harness.database.db, id)).toMatchObject({ attempts: 1, lockedAt: null });
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
      const rows = await harness.database.db.select({ status: jobs.status }).from(jobs);
      return rows.every(({ status }) => status === 'succeeded');
    }, 10_000);
    expect([...runs].sort()).toEqual([...labels].sort());
    const attempts = await harness.database.db.select({ attempts: jobs.attempts }).from(jobs);
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
    expect(await jobById(harness.database.db, id)).toMatchObject({
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
    expect((await jobById(harness.database.db, id)).attempts).toBe(2);
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
    await waitUntil(async () => (await jobById(harness.database.db, id)).lastError !== null);
    const job = await jobById(harness.database.db, id);
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
    expect(await jobById(harness.database.db, id)).toMatchObject({
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
    const [job] = await harness.database.db
      .insert(jobs)
      .values({ kind: labelJob.name, payload: { label: 42 } })
      .returning();
    await waitUntil(async () => (await statusOf(job?.id ?? '')) === 'failed');
    expect(runs).toBe(0);
    expect((await jobById(harness.database.db, job?.id ?? '')).lastError).toMatch(
      /^JobPayloadError: /,
    );
  });

  it('leaves a kind without handler in the queue', async () => {
    await start({ handlers: [handle(otherJob, () => Promise.resolve())] });
    const id = await queue('nobody handles this');
    const handled = await enqueue(harness.database.db, {
      kind: otherJob,
      payload: { label: 'handled' },
    });
    await waitUntil(async () => (await statusOf(handled)) === 'succeeded');
    expect(await jobById(harness.database.db, id)).toMatchObject({ status: 'queued', attempts: 0 });
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
    // The first handlers are held until two of them run together, however slowly the
    // jobs are claimed: the peak then says the limit was reached, and never passed.
    const together = createGate();
    const track = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      if (active >= 2) together.open();
      await together.opened;
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
        enqueue(harness.database.db, { kind: otherJob, payload: { label } }),
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
    const together = createGate();
    const track = (kind: 'limited' | 'free') => async (): Promise<void> => {
      active[kind] += 1;
      peak.limited = Math.max(peak.limited, active.limited);
      peak.together = Math.max(peak.together, active.limited + active.free);
      if (active.limited + active.free >= 2) together.open();
      await together.opened;
      await sleep(40);
      active[kind] -= 1;
    };
    await Promise.all(['a', 'b', 'c', 'd'].map(queue));
    await Promise.all(
      ['x', 'y'].map((label) =>
        enqueue(harness.database.db, { kind: otherJob, payload: { label } }),
      ),
    );
    await start({
      concurrency: 3,
      perKindConcurrency: { [labelJob.name]: 1 },
      handlers: [handle(labelJob, track('limited')), handle(otherJob, track('free'))],
    });
    await waitUntil(async () => {
      const rows = await harness.database.db.select({ status: jobs.status }).from(jobs);
      return rows.every(({ status }) => status === 'succeeded');
    });
    expect(peak.limited).toBe(1);
    expect(peak.together).toBeGreaterThan(1);
  });
});
