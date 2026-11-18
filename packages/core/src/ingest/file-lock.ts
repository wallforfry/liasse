import { type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';

export const fileLockKey = (sha256: string): SQL => sql`hashtextextended(${sha256}, 0)`;

/**
 * Serialises, until the transaction ends, everything that decides whether the stored
 * file of one hash must exist: an ingestion writes the file then its row, a deletion
 * removes the file only when no row needs it. Without it, a deletion could remove the
 * file an ingestion of the same bytes has just written and is about to reference.
 */
export const lockFile = async (
  transaction: Pick<Database, 'execute'>,
  sha256: string,
): Promise<void> => {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(${fileLockKey(sha256)})`);
};
