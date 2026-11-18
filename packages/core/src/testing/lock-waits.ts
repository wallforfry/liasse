import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';

const waitingSchema = z.tuple([z.object({ waiting: z.number().int() })]);

/**
 * The sessions of the current database that wait for a lock: a row, a table or an advisory
 * lock. A step held back by a lock is seen waiting here, which a test waits for instead of
 * waiting for a while and finding that the step has not finished.
 */
export const sessionsWaitingForALock = async (db: Database): Promise<number> => {
  // A session waiting for a row waits for a transaction, which `pg_locks` ties to no
  // database: the sessions are counted where their database is named.
  const [{ waiting }] = waitingSchema.parse(
    await db.execute(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()
    `),
  );
  return waiting;
};
