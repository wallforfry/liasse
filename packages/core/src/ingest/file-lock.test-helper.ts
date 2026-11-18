import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { fileLockKey } from './file-lock.ts';

const holderSchema = z.tuple([z.object({ pid: z.number().int() })]);

/**
 * The server process of the session that holds the lock of the file of `bytes`, such as
 * an ingestion held back inside its transaction. `pg_locks` shows an advisory lock on a
 * bigint key as its high half in `classid` and its low half in `objid`.
 */
export const fileLockHolder = async (db: Database, bytes: Uint8Array): Promise<number> => {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const [{ pid }] = holderSchema.parse(
    await db.execute(sql`
      SELECT locks.pid FROM pg_locks AS locks, (SELECT ${fileLockKey(sha256)} AS value) AS key
      WHERE locks.locktype = 'advisory' AND locks.granted AND locks.objsubid = 1
        AND locks.database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND locks.classid = ((key.value >> 32) & 4294967295)::oid
        AND locks.objid = (key.value & 4294967295)::oid
    `),
  );
  return pid;
};
