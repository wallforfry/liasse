import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { setStatus } from '../registry/lifecycle.ts';
import { withRegistryLock } from '../registry/type-store.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { applyByPolicy } from './apply-change.ts';
import { changesOf, seedChange, seedType, typeOf } from './consolidation.test-helper.ts';

const waitingSchema = z.tuple([z.object({ waiting: z.number() })]);

describe('the eligibility of a change applied by the policy', () => {
  let database: TestDatabase;
  const db = () => database.db;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const someoneWaitsForAnAdvisoryLock = async (): Promise<boolean> => {
    const [{ waiting }] = waitingSchema.parse(
      await db().execute(sql`
        SELECT count(*)::int AS waiting FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
      `),
    );
    return waiting > 0;
  };

  it('is read under the registry lock: a stabilization committed meanwhile is seen', async () => {
    const target = await seedType(db(), {
      slug: 'heating_bill',
      fields: { meter: { type: 'identifier' } },
    });
    const source = await seedType(db(), {
      slug: 'boiler_bill',
      fields: { meter: { type: 'identifier' } },
    });
    const change = await seedChange(
      db(),
      'merge',
      {
        source_id: source.id,
        target_id: target.id,
        field_mapping: { meter: 'meter' },
        confidence: 0.95,
      },
      true,
    );
    const held = createGate();
    const release = createGate();
    // A registry write that holds its lock, uncommitted, while the policy applies.
    const stabilizing = db().transaction(async (tx) => {
      await withRegistryLock(tx, async (locked) => {
        await setStatus(target.id, 'stable', { db: locked });
      });
      held.open();
      await release.opened;
    });
    await held.opened;
    const applying = applyByPolicy(db(), change, 'safe');
    await waitUntil(someoneWaitsForAnAdvisoryLock);
    release.open();
    await stabilizing;

    expect(await applying).toEqual({ outcome: 'not_eligible' });
    expect(await typeOf(db(), source.id)).toMatchObject({ status: 'provisional' });
    expect(await changesOf(db(), 'merge')).toMatchObject([{ status: 'pending', auto: false }]);
  });
});
