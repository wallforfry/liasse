import { isLiveStatus } from '@liasse/contract/domain';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import { defineJobKind } from '../jobs/kinds.ts';
import { parseStorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { lockFile } from './file-lock.ts';

// A storage outage must not leave the file of a deleted document behind: with the
// default backoff, eight attempts span about ten minutes.
const DELETE_FILE_ATTEMPTS = 8;

/** Queued by `deleteDocument`, in the transaction that turns the document into a tombstone. */
export const deleteFileJob = defineJobKind({
  name: 'delete_file',
  schema: z.object({ documentId: z.string().min(1) }),
  maxAttempts: DELETE_FILE_ATTEMPTS,
});

export interface DeleteFileDeps {
  readonly db: Database;
  readonly storage: Storage;
}

/**
 * The handler the server registers for `deleteFileJob`. It removes the stored file of
 * a tombstone and is safe to run any number of times.
 *
 * It looks at the document again under the lock of its hash: the same bytes may have
 * been ingested again since the deletion, which revives the row, and their file must
 * then stay.
 */
export const createDeleteFileHandler = ({ db, storage }: DeleteFileDeps): RegisteredHandler =>
  handle(deleteFileJob, async ({ payload }) => {
    const [document] = await db
      .select({ sha256: documents.sha256, storageKey: documents.storageKey })
      .from(documents)
      .where(eq(documents.id, payload.documentId));
    if (document === undefined) return;
    await db.transaction(async (tx) => {
      await lockFile(tx, document.sha256);
      const [current] = await tx
        .select({ status: documents.status })
        .from(documents)
        .where(eq(documents.id, payload.documentId));
      if (current === undefined || isLiveStatus(current.status)) return;
      await storage.delete(parseStorageKey(document.storageKey));
      // What `requeueFileDeletions` reads: without it the removal is still owed.
      await tx
        .update(documents)
        .set({ fileDeletedAt: sql`now()` })
        .where(and(eq(documents.id, payload.documentId), eq(documents.status, current.status)));
    });
  });
