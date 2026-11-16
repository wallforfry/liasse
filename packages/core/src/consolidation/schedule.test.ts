import { CONSOLIDATION_BATCH_DOCUMENTS } from '@liasse/contract/domain';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import {
  nextNightlyRun,
  queueBatchRunIfDue,
  queueManualRun,
  scheduleNightlyRun,
} from './schedule.ts';

describe('when consolidation runs', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeEach(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.dispose();
  });

  const runs = () =>
    db()
      .select({ payload: jobs.payload, status: jobs.status, runAfter: jobs.runAfter })
      .from(jobs)
      .where(eq(jobs.kind, 'consolidate'))
      .orderBy(asc(jobs.id));

  const settle = async (count: number, ingestedAt?: Date) => {
    for (let index = 0; index < count; index += 1) {
      await insertSyntheticDocument(db(), {
        status: 'indexed',
        ...(ingestedAt === undefined ? {} : { ingestedAt }),
      });
    }
  };

  it('runs every night at the same hour, the next one strictly ahead', () => {
    expect(nextNightlyRun(new Date('2026-11-14T01:00:00Z'))).toEqual(
      new Date('2026-11-14T03:00:00Z'),
    );
    expect(nextNightlyRun(new Date('2026-11-14T03:00:00Z'))).toEqual(
      new Date('2026-11-15T03:00:00Z'),
    );
    expect(nextNightlyRun(new Date('2026-12-31T22:00:00Z'))).toEqual(
      new Date('2027-01-01T03:00:00Z'),
    );
  });

  it('keeps one nightly run queued however often it is asked for', async () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(await scheduleNightlyRun(db(), now)).toBe(true);
    expect(await scheduleNightlyRun(db(), now)).toBe(false);
    expect(await runs()).toEqual([
      {
        payload: { trigger: 'nightly' },
        status: 'queued',
        runAfter: new Date('2026-11-15T03:00:00Z'),
      },
    ]);
  });

  it('queues a run once a batch of new documents has settled, and one only', async () => {
    await settle(CONSOLIDATION_BATCH_DOCUMENTS - 1);
    await insertSyntheticDocument(db(), { status: 'classified' });
    expect(await queueBatchRunIfDue(db())).toBe(false);
    await settle(1);
    expect(await Promise.all([queueBatchRunIfDue(db()), queueBatchRunIfDue(db())])).toEqual(
      expect.arrayContaining([true, false]),
    );
    expect(await runs()).toMatchObject([{ payload: { trigger: 'batch' }, status: 'queued' }]);
  });

  it('counts the documents from the start of the last run', async () => {
    await settle(CONSOLIDATION_BATCH_DOCUMENTS, new Date('2026-11-01T00:00:00Z'));
    await db()
      .insert(jobs)
      .values({
        kind: 'consolidate',
        payload: { trigger: 'nightly' },
        status: 'succeeded',
        runAfter: new Date('2026-11-02T03:00:00Z'),
      });
    expect(await queueBatchRunIfDue(db())).toBe(false);
    await settle(CONSOLIDATION_BATCH_DOCUMENTS);
    expect(await queueBatchRunIfDue(db())).toBe(true);
  });

  it('queues a manual run at once, beside the nightly one, and one only', async () => {
    const now = new Date('2026-11-14T12:00:00Z');
    await scheduleNightlyRun(db(), now);
    expect(await Promise.all([queueManualRun(db()), queueManualRun(db())])).toEqual(
      expect.arrayContaining([true, false]),
    );
    const queued = await runs();
    expect(queued.map(({ payload }) => payload)).toEqual([
      { trigger: 'nightly' },
      { trigger: 'manual' },
    ]);
    expect(queued[1]?.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('leaves a manual run to a batch run already queued, not to one in progress', async () => {
    await settle(CONSOLIDATION_BATCH_DOCUMENTS);
    expect(await queueBatchRunIfDue(db())).toBe(true);
    expect(await queueManualRun(db())).toBe(false);
    await db().update(jobs).set({ status: 'running' }).where(eq(jobs.kind, 'consolidate'));
    expect(await queueManualRun(db())).toBe(true);
    expect((await runs()).map(({ payload, status }) => [payload, status])).toEqual([
      [{ trigger: 'batch' }, 'running'],
      [{ trigger: 'manual' }, 'queued'],
    ]);
  });

  it('does not leave a manual run to a run waiting for its retry', async () => {
    await db()
      .insert(jobs)
      .values({
        kind: 'consolidate',
        payload: { trigger: 'batch' },
        runAfter: new Date(Date.now() + 60 * 60 * 1000),
      });
    expect(await queueManualRun(db())).toBe(true);
  });
});
