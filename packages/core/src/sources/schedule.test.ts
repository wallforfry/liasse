import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobs } from '../db/schema/jobs.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { cancelPolls, queuePollNow, scheduleNextPoll, seedSourcePolls } from './schedule.ts';
import { addSource, queuedPolls } from './sources.test-helper.ts';

describe('the schedule of the sources', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  beforeEach(async () => {
    await database.db.delete(jobs);
    await database.db.delete(ingestionSources);
  });

  it('queues the next run once, at the time asked', async () => {
    const id = await addSource(database.db, { enabled: false });
    const at = new Date(Date.now() + 60_000);
    expect(await scheduleNextPoll(database.db, id, at)).toBe(true);
    expect(await scheduleNextPoll(database.db, id, new Date())).toBe(false);
    const queued = await queuedPolls(database.db);
    expect(queued.map(({ runAfter, payload }) => ({ runAfter, payload }))).toEqual([
      { runAfter: at, payload: { sourceId: id } },
    ]);
  });

  it('queues a run due at once beside a later one, but never two due at once', async () => {
    const id = await addSource(database.db, { enabled: false });
    await scheduleNextPoll(database.db, id, new Date(Date.now() + 60_000));
    expect(await database.db.transaction((tx) => queuePollNow(tx, id))).toBe(true);
    expect(await database.db.transaction((tx) => queuePollNow(tx, id))).toBe(false);
    expect(await queuedPolls(database.db)).toHaveLength(2);
    await cancelPolls(database.db, id);
    expect(await queuedPolls(database.db)).toEqual([]);
  });

  it('seeds a run for each enabled source that waits for no one and has none', async () => {
    const waiting = await addSource(database.db);
    const idle = await addSource(database.db);
    await addSource(database.db, { enabled: false });
    const flagged = await addSource(database.db);
    await database.db
      .update(ingestionSources)
      .set({ needsAttention: true })
      .where(eq(ingestionSources.id, flagged));
    await database.db.delete(jobs);
    await scheduleNextPoll(database.db, waiting, new Date(Date.now() + 60_000));

    expect(await seedSourcePolls(database.db)).toBe(1);

    const queued = await queuedPolls(database.db);
    expect(queued.map(({ payload }) => payload).toSorted()).toEqual(
      [{ sourceId: waiting }, { sourceId: idle }].toSorted(),
    );
  });
});
