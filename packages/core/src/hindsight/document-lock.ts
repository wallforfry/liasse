import { z } from 'zod';
import type { Database } from '../db/client.ts';

const lockAnswer = z.tuple([z.object({ locked: z.boolean() })]);

/**
 * Runs `run` while holding the sync lock of one document, or resolves to undefined at
 * once when another sync of that document holds it.
 *
 * Two syncs of one document at once could reach Hindsight in one order and record
 * their outcomes in the other. The lock is a session-level advisory lock on a
 * connection reserved for it: no transaction stays open while `run` talks to
 * Hindsight, and a process that dies gives the lock back with its connection. A
 * compare-and-set on the row would hold no connection at all, but two syncs that keep
 * overlapping would keep invalidating each other; this costs one idle connection per
 * sync in flight, which `HINDSIGHT_SYNC_CONCURRENCY` bounds.
 */
export const withDocumentSyncLock = async <Result>(
  db: Database,
  documentId: string,
  run: () => Promise<Result>,
): Promise<Result | undefined> => {
  const key = `liasse.hindsight:${documentId}`;
  const connection = await db.$client.reserve();
  try {
    const [{ locked }] = lockAnswer.parse(
      await connection`SELECT pg_try_advisory_lock(hashtextextended(${key}, 0)) AS locked`,
    );
    if (!locked) return undefined;
    try {
      return await run();
    } finally {
      await connection`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
    }
  } finally {
    connection.release();
  }
};
