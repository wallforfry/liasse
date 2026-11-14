import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { parseStorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { lockFile } from './file-lock.ts';

export interface DeleteDocumentDeps {
  readonly db: Database;
  readonly storage: Storage;
}

/**
 * Deletes a document, the rows derived from it and its stored file. Resolves to false
 * when the document does not exist.
 *
 * The rows go first: a crash or a storage failure after that leaves a file without a
 * document, never the reverse. A storage failure rejects although the document is gone.
 */
export const deleteDocument = async (
  { db, storage }: DeleteDocumentDeps,
  id: string,
): Promise<boolean> => {
  const [deleted] = await db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ sha256: documents.sha256, storageKey: documents.storageKey });
  if (deleted === undefined) return false;

  await db.transaction(async (tx) => {
    await lockFile(tx, deleted.sha256);
    const [ingestedAgain] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.sha256, deleted.sha256));
    if (ingestedAgain === undefined) await storage.delete(parseStorageKey(deleted.storageKey));
  });
  return true;
};
