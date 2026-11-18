import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';

const pidSchema = z.tuple([z.object({ pid: z.number().int() })]);
const blockedSchema = z.tuple([z.object({ blocked: z.number().int() })]);

/** The server process of the session that runs `executor`, such as a transaction. */
export const backendPid = async (executor: Pick<Database, 'execute'>): Promise<number> => {
  const [{ pid }] = pidSchema.parse(await executor.execute(sql`SELECT pg_backend_pid() AS pid`));
  return pid;
};

/**
 * Whether at least `sessions` sessions wait, directly or behind another waiter, for a lock
 * the session `holder` holds. A step held back by a lock is seen waiting here, which a test
 * waits for instead of waiting for a while and finding that the step has not finished. A
 * session that waits for a lock of someone else is not counted.
 */
export const holdsBack = async (db: Database, holder: number, sessions = 1): Promise<boolean> => {
  const [{ blocked }] = blockedSchema.parse(
    await db.execute(sql`
      WITH RECURSIVE blocked (pid) AS (
        SELECT pid FROM pg_stat_activity WHERE ${holder}::int = ANY (pg_blocking_pids(pid))
        UNION
        SELECT waiter.pid FROM pg_stat_activity AS waiter
        JOIN blocked ON blocked.pid = ANY (pg_blocking_pids(waiter.pid))
      )
      SELECT count(*)::int AS blocked FROM blocked WHERE pid <> ${holder}::int
    `),
  );
  return blocked >= sessions;
};
