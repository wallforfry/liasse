import { MAX_LISTED_CONSOLIDATION_RUNS } from '@liasse/contract/domain';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { recentConsolidationRuns } from './runs.ts';
import { consolidateJob, queueManualRun, scheduleNightlyRun } from './schedule.ts';

describe('the latest consolidation runs', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  const fail = (id: string, attempts: number, status: 'queued' | 'failed') =>
    db()
      .update(jobs)
      .set({ status, attempts, lastError: 'Error: the text model refused the request' })
      .where(eq(jobs.id, id));

  it('lists a run asked for by hand with its state, and its error once it failed', async () => {
    await queueManualRun(db());
    const [queued] = await recentConsolidationRuns(db());
    expect(queued).toMatchObject({
      trigger: 'manual',
      status: 'queued',
      attempts: 0,
      last_error: null,
    });
    expect(queued?.due_at).toBe(queued?.queued_at);
    await fail(queued?.id ?? '', 3, 'failed');
    expect(await recentConsolidationRuns(db())).toEqual([
      {
        ...queued,
        status: 'failed',
        attempts: 3,
        last_error: 'Error: the text model refused the request',
      },
    ]);
  });

  it('leaves out the next nightly run until it is due, or failed an attempt', async () => {
    await scheduleNightlyRun(db(), new Date());
    expect(await recentConsolidationRuns(db())).toEqual([]);
    const [nightly] = await db().select({ id: jobs.id }).from(jobs);
    await fail(nightly?.id ?? '', 1, 'queued');
    expect(await recentConsolidationRuns(db())).toMatchObject([
      { trigger: 'nightly', status: 'queued', attempts: 1 },
    ]);
    await db()
      .update(jobs)
      .set({ attempts: 0, lastError: null, runAfter: sql`now() - interval '1 minute'` })
      .where(eq(jobs.id, nightly?.id ?? ''));
    expect(await recentConsolidationRuns(db())).toMatchObject([{ trigger: 'nightly' }]);
  });

  it('lists the newest first, at most the limit, and no job of another kind', async () => {
    const triggers = Array.from({ length: MAX_LISTED_CONSOLIDATION_RUNS + 2 }, (_, index) =>
      index % 2 === 0 ? ('batch' as const) : ('manual' as const),
    );
    for (const trigger of triggers) {
      await enqueue(db(), { kind: consolidateJob, payload: { trigger } });
    }
    await db()
      .insert(jobs)
      .values({ kind: 'process_document', payload: { documentId: 'doc_x' } });
    const listed = await recentConsolidationRuns(db());
    const all = await db()
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.kind, consolidateJob.name))
      .orderBy(sql`${jobs.createdAt} desc, ${jobs.id} desc`);
    expect(listed.map(({ id }) => id)).toEqual(
      all.slice(0, MAX_LISTED_CONSOLIDATION_RUNS).map(({ id }) => id),
    );
  });
});
