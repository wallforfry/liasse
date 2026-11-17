import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './client.ts';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export const READ_COMMITTED = 'read committed';

const isolationSchema = z.tuple([z.object({ transaction_isolation: z.string() })]);

/**
 * For a transaction a caller opened before it takes an advisory lock in it: a snapshot
 * taken before the lock was granted would hide what the previous holder committed, so
 * under any stricter level the lock would protect nothing.
 */
export const assertReadCommitted = async (tx: Transaction, writes: string): Promise<void> => {
  const [{ transaction_isolation: level }] = isolationSchema.parse(
    await tx.execute(sql`SHOW transaction_isolation`),
  );
  if (level !== READ_COMMITTED) {
    throw new Error(
      `${writes} are written in a ${READ_COMMITTED} transaction; this one is ${level}.`,
    );
  }
};
