import type { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { parseStorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';

export interface DocumentFileDeps {
  readonly db: Database;
  readonly storage: Storage;
}

/** The original file of a document. Where it is stored stays inside the storage port. */
export interface DocumentFile {
  readonly mime: string;
  readonly filename: string;
  readonly sha256: string;
  /** Both reject with `StorageObjectNotFoundError` when the stored file is gone. */
  readonly bytes: () => Promise<Uint8Array>;
  readonly stream: () => Promise<Readable>;
}

export const getDocumentFile = async (
  { db, storage }: DocumentFileDeps,
  id: string,
): Promise<DocumentFile | undefined> => {
  const [document] = await db
    .select({
      mime: documents.mime,
      filename: documents.originalName,
      sha256: documents.sha256,
      storageKey: documents.storageKey,
    })
    .from(documents)
    .where(eq(documents.id, id));
  if (document === undefined) return undefined;
  const { storageKey, ...described } = document;
  const key = parseStorageKey(storageKey);
  return {
    ...described,
    bytes: () => storage.get(key),
    stream: () => storage.getStream(key),
  };
};
