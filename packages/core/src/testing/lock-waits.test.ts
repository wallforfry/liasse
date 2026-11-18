import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGate, waitUntil } from './async.ts';
import { backendPid, holdsBack } from './lock-waits.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

describe('holdsBack', () => {
  let database: TestDatabase;

  const lock = (key: number) => sql`SELECT pg_advisory_xact_lock(${key}::bigint)`;

  // A query of drizzle runs once it is awaited; a transaction starts at once.
  const waitFor = (key: number) => database.db.transaction((tx) => tx.execute(lock(key)));

  // Holds the advisory lock `key` in a transaction until `release` is called.
  const hold = async (key: number) => {
    const holding = createGate<number>();
    const release = createGate();
    const transaction = database.db.transaction(async (tx) => {
      await tx.execute(lock(key));
      holding.open(await backendPid(tx));
      await release.opened;
    });
    return {
      pid: await holding.opened,
      release: async () => {
        release.open();
        await transaction;
      },
    };
  };

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('counts the sessions that wait for the holder, directly or behind a waiter, and no other', async () => {
    const holder = await hold(1);
    const other = await hold(2);
    const inFlight: Promise<unknown>[] = [];
    try {
      inFlight.push(waitFor(2));
      await waitUntil(() => holdsBack(database.db, other.pid));
      expect(await holdsBack(database.db, holder.pid)).toBe(false);

      inFlight.push(
        database.db.transaction(async (tx) => {
          await tx.execute(lock(3));
          await tx.execute(lock(1));
        }),
      );
      await waitUntil(() => holdsBack(database.db, holder.pid));
      inFlight.push(waitFor(3));
      await waitUntil(() => holdsBack(database.db, holder.pid, 2));
      expect(await holdsBack(database.db, holder.pid, 3)).toBe(false);
    } finally {
      await holder.release();
      await other.release();
      await Promise.allSettled(inFlight);
    }
    await Promise.all(inFlight);
  });

  // `deadlock_timeout` is long on both sides, so the cycle lasts until the test cancels the
  // waiter.
  it('does not count the holder in a cycle that leads back to it', async () => {
    const slowDetection = sql`SET LOCAL deadlock_timeout = '1h'`;
    const holding = createGate<number>();
    const closeCycle = createGate();
    const holderTransaction = database.db.transaction(async (tx) => {
      await tx.execute(slowDetection);
      await tx.execute(lock(4));
      holding.open(await backendPid(tx));
      await closeCycle.opened;
      await tx.execute(lock(5));
    });
    const holder = await holding.opened;
    const waiting = createGate<number>();
    const waiterTransaction = database.db.transaction(async (tx) => {
      await tx.execute(slowDetection);
      await tx.execute(lock(5));
      waiting.open(await backendPid(tx));
      await tx.execute(lock(4));
    });
    const waiter = await waiting.opened;
    try {
      await waitUntil(() => holdsBack(database.db, holder));
      closeCycle.open();
      await waitUntil(() => holdsBack(database.db, waiter));
      expect(await holdsBack(database.db, holder, 2)).toBe(false);
    } finally {
      closeCycle.open();
      await database.db.execute(sql`SELECT pg_cancel_backend(${waiter}::int)`);
      await Promise.allSettled([holderTransaction, waiterTransaction]);
    }
    await holderTransaction;
    await expect(waiterTransaction).rejects.toThrow();
  });
});
