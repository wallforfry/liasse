import { sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Database } from '../db/client.ts';
import { assertReadCommitted, READ_COMMITTED } from '../db/isolation.ts';
import type { EntityTransaction } from './entity-store.ts';

// A database, or a transaction the caller has opened and will commit itself.
export type EntityExecutor = Database | EntityTransaction;

const isTransaction = (executor: EntityExecutor): executor is EntityTransaction =>
  executor instanceof PgTransaction;

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.entities'))`;

// Takes the lock in a read committed transaction, held until it ends. Re-entrant: a
// later `withEntityLock` in the same transaction goes through at once.
export const lockEntities = async (tx: EntityTransaction): Promise<void> => {
  await assertReadCommitted(tx, 'Entities');
  await tx.execute(LOCK);
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
    await lockEntities(executor);
    return executor.transaction(work);
  }
  return executor.transaction(
    async (tx) => {
      await tx.execute(LOCK);
      return work(tx);
    },
    { isolationLevel: READ_COMMITTED },
  );
};
