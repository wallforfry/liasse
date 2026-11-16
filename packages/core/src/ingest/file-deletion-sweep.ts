import { TOMBSTONE_STATUS } from '@liasse/contract/domain';
import { and, eq, isNull, notExists } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs, unfinishedJobOfDocument } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { deleteFileJob } from './delete-file-job.ts';

export interface FileDeletionSweepDeps {
  readonly db: Database;
}

export interface FileDeletionSweepOptions {
  /** How many removals one call queues at most. */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 500;

/**
 * For startup. A `delete_file` job gives up after its attempts (about ten minutes with
 * the default backoff), and a storage outage can last longer: the file of a deleted
 * document would then stay for good. This queues the removal again for every tombstone
 * that still owes it (`file_deleted_at` is null) and has no `delete_file` job queued or
 * running. Resolves to the number of removals queued.
 *
 * It asks the storage nothing: the handler removes an absent file without failing. It
 * is safe to call at every start and from several processes, since a removal queued
 * twice is run twice to the same effect.
 */
export const requeueFileDeletions = async (
  { db }: FileDeletionSweepDeps,
  { limit = DEFAULT_LIMIT }: FileDeletionSweepOptions = {},
): Promise<number> => {
  const removalInProgress = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, deleteFileJob.name), unfinishedJobOfDocument(documents.id)));
  const owed = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.status, TOMBSTONE_STATUS),
        isNull(documents.fileDeletedAt),
        notExists(removalInProgress),
      ),
    )
    .orderBy(documents.updatedAt, documents.id)
    .limit(limit);
  for (const { id } of owed) {
    await enqueue(db, { kind: deleteFileJob, payload: { documentId: id } });
  }
  return owed.length;
};
