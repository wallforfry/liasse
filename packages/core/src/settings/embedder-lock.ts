import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';

type Executor = Pick<Database, 'execute'>;

const EMBEDDER_LOCK = sql`hashtextextended('liasse.embedder', 0)`;

/**
 * Taken in the transaction that makes a document live (a new one, or a tombstone revived),
 * after the lock of its hash. Many ingestions hold it at once; a save that changes the
 * embedder waits for them, and they wait for that save.
 */
export const holdEmbedderShared = async (tx: Executor): Promise<void> => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${EMBEDDER_LOCK})`);
};

/**
 * Taken by a save that changes the embedder, before it counts the live documents: none
 * can appear until its transaction ends, by which time the new embedder is in force.
 */
export const holdEmbedderExclusive = async (tx: Executor): Promise<void> => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${EMBEDDER_LOCK})`);
};
