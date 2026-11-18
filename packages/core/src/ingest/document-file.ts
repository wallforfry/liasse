import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { parseStorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';

/** The source holds other bytes than those Liasse indexed for the document. */
export class SourceFileChangedError extends Error {
  override readonly name = 'SourceFileChangedError';
}

/** No source still holds the file of the document where its configuration points. */
export class SourceFileUnavailableError extends Error {
  override readonly name = 'SourceFileUnavailableError';
}

/**
 * The files that stay at their source. `open` rejects with `SourceFileChangedError` or
 * `SourceFileUnavailableError`; any other rejection is transient.
 */
export interface SourceFiles {
  readonly open: (documentId: string, signal?: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;
}

export interface DocumentFileDeps {
  readonly db: Database;
  readonly storage: Storage;
  readonly sourceFiles: SourceFiles;
}

/** The original file of a document. Where it is stays inside the storage port or the source. */
export interface DocumentFile {
  readonly mime: string;
  readonly filename: string;
  readonly sha256: string;
  /**
   * Both reject with `StorageObjectNotFoundError` when the stored file is gone, and as
   * `SourceFiles.open` does for a file kept at a source.
   */
  readonly bytes: (signal?: AbortSignal) => Promise<Uint8Array>;
  readonly stream: (signal?: AbortSignal) => Promise<Readable>;
}

const collect = async (stream: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

// The checksum of the source was compared before the download; the hash of the bytes is
// the exact test, and what the text of a document is extracted from must pass it.
const sourceBytes = async (
  sourceFiles: SourceFiles,
  id: string,
  sha256: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
  const bytes = await collect(await sourceFiles.open(id, signal));
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new SourceFileChangedError('The source holds other bytes than those indexed.');
  }
  return bytes;
};

export const getDocumentFile = async (
  { db, storage, sourceFiles }: DocumentFileDeps,
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
    .where(and(eq(documents.id, id), isLiveDocument));
  if (document === undefined) return undefined;
  const { storageKey, ...described } = document;
  if (storageKey === null) {
    return {
      ...described,
      bytes: (signal) => sourceBytes(sourceFiles, id, described.sha256, signal),
      stream: async (signal) =>
        Readable.from(await sourceFiles.open(id, signal), { objectMode: false }),
    };
  }
  const key = parseStorageKey(storageKey);
  return {
    ...described,
    bytes: () => storage.get(key),
    stream: () => storage.getStream(key),
  };
};
