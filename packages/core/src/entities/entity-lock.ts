import { sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import type { EntityTransaction } from './entity-store.ts';

// A database, or a transaction the caller has opened and will commit itself.
export type EntityExecutor = Database | EntityTransaction;

const isTransaction = (executor: EntityExecutor): executor is EntityTransaction =>
  executor instanceof PgTransaction;

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.entities'))`;

const REQUIRED_ISOLATION = 'read committed';
const isolationSchema = z.tuple([z.object({ transaction_isolation: z.string() })]);

// A snapshot taken before the lock was granted would hide what the previous holder
// committed: under any stricter level the lock would protect nothing.
const assertReadCommitted = async (tx: EntityTransaction): Promise<void> => {
  const [{ transaction_isolation: level }] = isolationSchema.parse(
    await tx.execute(sql`SHOW transaction_isolation`),
  );
  if (level !== REQUIRED_ISOLATION) {
    throw new Error(
      `Entities are written in a ${REQUIRED_ISOLATION} transaction; this one is ${level}.`,
    );
  }
};

// Every write to `entities`, and every write of an entity id elsewhere, runs under this
// one lock. Resolution reads before it writes (no identifier, name or alias matches, so
// create), and what it reads spans identifiers, names and aliases of every row: no unique
// index can express it. A unique index on a stored normalized name would also go stale
// whenever the normalizer changes. Entities are written a few times per document, so
// serializing the writes costs little.
//
// Given a database, the work runs in a transaction of its own. Given a transaction, the
// lock is taken in it and held until the caller commits or rolls back, and the work runs
// in a savepoint: a failure undoes the work and leaves the rest to the caller.
export const withEntityLock = async <Outcome>(
  executor: EntityExecutor,
  work: (tx: EntityTransaction) => Promise<Outcome>,
): Promise<Outcome> => {
  if (isTransaction(executor)) {
    await assertReadCommitted(executor);
    await executor.execute(LOCK);
    return executor.transaction(work);
  }
  return executor.transaction(
    async (tx) => {
      await tx.execute(LOCK);
      return work(tx);
    },
    { isolationLevel: REQUIRED_ISOLATION },
  );
};
