import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { withSessionAdvisoryLock } from '../db/session-lock.ts';

const KEY = sql`hashtextextended('liasse.consolidation-run', 0)`;

/**
 * Runs `run` while no other run of consolidation runs, in this process or another, or
 * resolves to undefined at once when one does: the run in progress does the same work.
 * A run that outlives a lost lock may overlap another, which the lock on each change row
 * keeps from deciding a change twice.
 */
export const withConsolidationRunLock = <Result>(
  db: Database,
  run: () => Promise<Result>,
): Promise<Result | undefined> => withSessionAdvisoryLock(db, KEY, run);
