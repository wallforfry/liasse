import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGate, waitUntil } from '../testing/async.ts';
import { enqueue } from './enqueue.ts';
import { handle, type HandlerSet } from './handlers.ts';
import { eq, sql } from 'drizzle-orm';
import { jobs } from '../db/schema/jobs.ts';
import { jobById, labelJob, otherJob } from './kinds.test-helper.ts';
import { createWorkersHarness, type WorkersHarness } from './workers.test-helper.ts';

describe('workers following a handler set', () => {
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

  const succeeded = (id: string) => async () => (await harness.statusOf(id)) === 'succeeded';

  it('runs a job with the handler of the set in force when it is claimed', async () => {
    const seen: string[] = [];
    const release = createGate();
    const started = createGate();
    const setOf = (name: string): HandlerSet => ({
      handlers: [
        handle(labelJob, async ({ payload }) => {
          if (payload.label === 'slow') {
            started.open();
            await release.opened;
          }
          seen.push(`${payload.label}:${name}`);
        }),
      ],
    });
    let current = setOf('first');
    await harness.start({ handlers: () => current });

    const slow = await harness.queue('slow');
    await started.opened;
    current = setOf('second');
    const after = await harness.queue('after');
    await waitUntil(succeeded(after));
    release.open();
    await waitUntil(succeeded(slow));

    expect(seen).toEqual(['after:second', 'slow:first']);
  });

  it('takes the handler from the set in force once the claim returns, not before it', async () => {
    const seen: string[] = [];
    const setOf = (name: string): HandlerSet => ({
      handlers: [
        handle(labelJob, ({ payload }) => {
          seen.push(`${payload.label}:${name}`);
          return Promise.resolve();
        }),
      ],
    });
    let current = setOf('first');
    const queued = await harness.queue('claimed');
    const { db } = harness.database;
    const locked = createGate();
    const release = createGate();
    // A table lock holds the UPDATE of the claim after the set was read for it.
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE jobs IN SHARE MODE`);
      locked.open();
      await release.opened;
    });
    await locked.opened;
    await harness.start({ handlers: () => current });
    await waitUntil(async () => (await waitingOnJobs()) > 0);
    current = setOf('second');
    release.open();
    await holder;
    await waitUntil(succeeded(queued));
    expect(seen).toEqual(['claimed:second']);
  });

  const waitingOnJobs = async (): Promise<number> => {
    const rows = await harness.database.db.$client`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'relation' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND relation = 'jobs'::regclass`;
    return Number(rows[0]?.waiting ?? 0);
  };

  it('runs a job of newer settings only once they are caught up, never before', async () => {
    const seen: string[] = [];
    const setOf = (name: string): HandlerSet => ({
      handlers: [
        handle(labelJob, ({ payload }) => {
          seen.push(`${payload.label}:${name}`);
          return Promise.resolve();
        }),
      ],
    });
    let applied = 1;
    let current = setOf('version 1');
    const catchUp = createGate();
    const caughtUp = createGate();
    const id = await harness.queue('newer');
    await harness.database.db.update(jobs).set({ settingsVersion: 2 }).where(eq(jobs.id, id));
    await harness.start({
      handlers: () => current,
      settings: {
        applied: () => applied,
        catchUp: async () => {
          catchUp.open();
          await caughtUp.opened;
          current = setOf('version 2');
          applied = 2;
        },
      },
    });
    await catchUp.opened;
    expect(seen).toEqual([]);
    caughtUp.open();
    await waitUntil(succeeded(id));
    expect(seen).toEqual(['newer:version 2']);
  });

  it('puts back, without counting an attempt, a job its settings cannot catch up with', async () => {
    let tries = 0;
    const id = await harness.queue('stale');
    await harness.database.db.update(jobs).set({ settingsVersion: 3 }).where(eq(jobs.id, id));
    await harness.start({
      handlers: [handle(labelJob, () => Promise.reject(new Error('never runs')))],
      settings: {
        applied: () => 1,
        catchUp: () => {
          tries += 1;
          return Promise.resolve();
        },
      },
    });
    await waitUntil(() => tries === 1);
    await waitUntil(async () => (await jobById(harness.database.db, id)).status === 'queued');
    const job = await jobById(harness.database.db, id);
    expect(job.attempts).toBe(0);
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it('claims a kind only while the set in force has its handler', async () => {
    const ran: string[] = [];
    const record = ({ payload }: { readonly payload: { readonly label: string } }) => {
      ran.push(payload.label);
      return Promise.resolve();
    };
    let current: HandlerSet = { handlers: [handle(otherJob, record)] };
    await harness.start({ handlers: () => current });

    const waiting = await harness.queue('label');
    const other = await enqueue(harness.database.db, {
      kind: otherJob,
      payload: { label: 'other' },
    });
    await waitUntil(succeeded(other));
    expect(await harness.statusOf(waiting)).toBe('queued');

    current = { handlers: [handle(otherJob, record), handle(labelJob, record)] };
    await waitUntil(succeeded(waiting));
    expect(ran).toEqual(['other', 'label']);
  });
});
