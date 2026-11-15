import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import type { MergeChangeKind } from '../entities/proposal-store.ts';
import { withEntityLock } from '../entities/entity-lock.ts';
import { seedEntity } from '../entities/support.test-helper.ts';
import { seedSubject } from '../knowledge/support.test-helper.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { decideChange } from './apply-change.ts';
import { changesOf, seedChange } from './consolidation.test-helper.ts';

const waitingSchema = z.tuple([z.object({ waiting: z.number() })]);

const advisoryWaiters = async (db: Database): Promise<number> => {
  const [{ waiting }] = waitingSchema.parse(
    await db.execute(sql`
      SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype = 'advisory' AND NOT granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    `),
  );
  return waiting;
};

type Seeder = (db: Database, name: string) => Promise<string>;

const SEEDERS: Readonly<Record<MergeChangeKind, Seeder>> = {
  merge_entity: (db, name) => seedEntity(db, { name }),
  merge_subject: (db, name) => seedSubject(db, { kind: 'vehicle', name }),
};

// Two merges of one source into two targets: applying either rewrites the pending row of
// the other. Both decisions are queued behind the entity lock before either runs, so
// whichever runs first meets the other's change row, which must not be locked yet.
describe('two concurrent merge decisions', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it.each(['merge_entity', 'merge_subject'] as const)('never deadlock (%s)', async (kind) => {
    const seed = SEEDERS[kind];
    const source = await seed(db(), `Lock order source ${kind}`);
    const first = await seed(db(), `Lock order first target ${kind}`);
    const second = await seed(db(), `Lock order second target ${kind}`);
    const toFirst = await seedChange(db(), kind, { source_id: source, target_id: first });
    const toSecond = await seedChange(db(), kind, { source_id: source, target_id: second });

    const holding = createGate();
    const release = createGate();
    const holder = withEntityLock(db(), async () => {
      holding.open();
      await release.opened;
    });
    await holding.opened;
    const decisions = Promise.all([
      decideChange(db(), toFirst, 'apply', null),
      decideChange(db(), toSecond, 'apply', null),
    ]);
    await waitUntil(async () => (await advisoryWaiters(db())) === 2);
    release.open();
    await holder;

    const outcomes = await decisions;
    expect(outcomes.map(({ outcome }) => outcome)).toEqual(['decided', 'decided']);
    const statuses = (await changesOf(db(), kind))
      .filter(({ id }) => id === toFirst || id === toSecond)
      .map(({ status }) => status);
    expect(statuses).toEqual(['applied', 'applied']);
  });
});
