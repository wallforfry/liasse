import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { withReservedConnection } from '../db/reserved.ts';

const KEY = sql`hashtextextended('liasse.consolidation-run', 0)`;

const lockAnswer = z.tuple([z.object({ locked: z.boolean() })]);

/**
 * Runs `run` while no other run of consolidation runs, in this process or another, or
 * resolves to undefined at once when one does: the run in progress does the same work.
 *
 * The lock is a session-level advisory lock on a connection reserved for it and held for
 * the whole run, which makes its own transactions through the pool: a run spans many
 * transactions and model calls, so no transaction can hold it. A lock is lost with its
 * backend; a run that outlives a lost lock may then overlap another, which the lock on
 * each change row keeps from deciding a change twice.
 */
export const withConsolidationRunLock = <Result>(
  db: Database,
  run: () => Promise<Result>,
): Promise<Result | undefined> =>
  withReservedConnection(db, async (connection) => {
    const [{ locked }] = lockAnswer.parse(
      await connection.execute(sql`SELECT pg_try_advisory_lock(${KEY}) AS locked`),
    );
    if (!locked) return undefined;
    try {
      return await run();
    } finally {
      // Fails only on a broken connection, whose backend took the lock with it. That
      // failure must not replace the error of the run.
      await connection.execute(sql`SELECT pg_advisory_unlock(${KEY})`).catch(() => undefined);
    }
  });
