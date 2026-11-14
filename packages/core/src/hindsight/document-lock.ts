import { type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { withReservedConnection } from '../db/reserved.ts';

/** The connection a sync runs on, and the condition that it still holds the lock. */
export interface SyncSession {
  /** Every statement of the sync goes here: one sync needs one connection, no more. */
  readonly db: Database;
  /**
   * True while the connection running the statement holds the lock of the document.
   * A lock is lost with its backend (restart, network cut, terminated session); a write
   * that rests on the lock adds this to its `where`, so it never lands after that.
   */
  readonly holdsLock: SQL;
}

const lockKey = (documentId: string): SQL =>
  sql`hashtextextended(${`liasse.hindsight:${documentId}`}, 0)`;

// A session lock on one bigint key is listed in `pg_locks` with its high 32 bits as
// `classid`, its low 32 bits as `objid`, and `objsubid` 1.
const holdsLockOf = (key: SQL): SQL => sql`EXISTS (
  SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid() AND objsubid = 1
    AND classid = ((${key} >> 32) & 4294967295)::oid
    AND objid = (${key} & 4294967295)::oid
)`;

const lockAnswer = z.tuple([z.object({ locked: z.boolean() })]);

/**
 * Runs `run` while holding the sync lock of one document, or resolves to undefined at
 * once when another sync of that document holds it.
 *
 * Two syncs of one document at once could reach Hindsight in one order and record
 * their outcomes in the other. The lock is a session-level advisory lock on a
 * connection reserved for the sync, which runs every statement on it: no transaction
 * stays open while the sync talks to Hindsight, and one sync never needs a second
 * connection, whatever the size of the pool. A compare-and-set on the row would hold
 * no connection at all, but two syncs that keep overlapping would keep invalidating
 * each other.
 */
export const withDocumentSyncLock = <Result>(
  db: Database,
  documentId: string,
  run: (session: SyncSession) => Promise<Result>,
): Promise<Result | undefined> =>
  withReservedConnection(db, async (connection) => {
    const key = lockKey(documentId);
    const [{ locked }] = lockAnswer.parse(
      await connection.execute(sql`SELECT pg_try_advisory_lock(${key}) AS locked`),
    );
    if (!locked) return undefined;
    try {
      return await run({ db: connection, holdsLock: holdsLockOf(key) });
    } finally {
      // Fails only on a broken connection, whose backend took the lock with it. That
      // failure must not replace the error of the sync, which says what to record.
      await connection.execute(sql`SELECT pg_advisory_unlock(${key})`).catch(() => undefined);
    }
  });
