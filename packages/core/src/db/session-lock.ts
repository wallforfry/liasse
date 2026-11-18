import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './client.ts';
import { withReservedConnection } from './reserved.ts';

const lockAnswer = z.tuple([z.object({ locked: z.boolean() })]);

/**
 * Runs `run` while no other holder of the advisory lock `key` runs, in this process or
 * another, or resolves to undefined at once when one does.
 *
 * The lock is a session-level advisory lock on a connection reserved for it and held for
 * the whole of `run`, which makes its own transactions through the pool: work that spans
 * many transactions and remote calls cannot hold a transaction open. A lock is lost with
 * its backend; a run that outlives a lost lock may then overlap another.
 */
export const withSessionAdvisoryLock = <Result>(
  db: Database,
  key: SQL,
  run: () => Promise<Result>,
): Promise<Result | undefined> =>
  withReservedConnection(db, async (connection) => {
    const [{ locked }] = lockAnswer.parse(
      await connection.execute(sql`SELECT pg_try_advisory_lock(${key}) AS locked`),
    );
    if (!locked) return undefined;
    try {
      return await run();
    } finally {
      // Fails only on a broken connection, whose backend took the lock with it. That
      // failure must not replace the error of the run.
      await connection.execute(sql`SELECT pg_advisory_unlock(${key})`).catch(() => undefined);
    }
  });
