import {
  type DocumentSource,
  type DocumentStatus,
  isLiveStatus,
  MAX_WATCH_REQUEUES,
  type SupportedMime,
} from '@liasse/contract/domain';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { enqueue } from '../jobs/enqueue.ts';
import type { StorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { processDocumentJob } from './process-document-job.ts';
import { requeueFailed } from './requeue-failed.ts';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A file that passed the checks of ingestion, ready to be stored. */
export interface IncomingFile {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly storageKey: StorageKey;
  /** The source keeps the file: nothing is written to the storage for it. */
  readonly byReference: boolean;
  readonly mime: SupportedMime;
  readonly filename: string;
  readonly source: DocumentSource;
  readonly hint: string | undefined;
  readonly private: boolean;
  readonly revivesDeleted: boolean;
}

export interface IngestResult {
  readonly id: string;
  readonly status: DocumentStatus;
  /**
   * True when these bytes already had a document, `id`. A deleted document handed back
   * through the API or MCP is revived under its id and counts as new.
   */
  readonly duplicate: boolean;
  /** True when the document existed but its stored file was missing, and was written again. */
  readonly fileRestored: boolean;
}

export interface ExistingDocument {
  readonly id: string;
  readonly status: DocumentStatus;
  readonly fileAtSource: boolean;
}

// Where a document's file is once these bytes are written to the storage.
const storedFile = (file: IncomingFile) => ({ storageKey: file.storageKey, fileAtSource: false });

const queueProcessing = (tx: Transaction, documentId: string): Promise<string> =>
  enqueue(tx, { kind: processDocumentJob, payload: { documentId } });

/** Undefined when the document is no longer in the status the decision was made on. */
type Attempt = IngestResult | undefined;

/**
 * Locks the row and tells whether it still has the status that was read. Everything
 * written after a true answer rests on a status that can no longer change before the
 * commit. `deleteDocument` takes the lock of the hash, which already keeps it out of an
 * ingestion; this holds even for a writer that does not.
 */
const stillIn = async (tx: Transaction, { id, status }: ExistingDocument): Promise<boolean> => {
  const [locked] = await tx
    .select({ status: documents.status })
    .from(documents)
    .where(eq(documents.id, id))
    .for('update');
  return locked?.status === status;
};

// A file still lying in the watched folder is seen again at every restart, and an email
// carries its attachments again each time it is read: neither is a request to undo a
// deletion. An upload or an MCP call of the file itself is one.
const reviveTombstone = async (
  tx: Transaction,
  storage: Storage,
  tombstone: ExistingDocument,
  file: IncomingFile,
): Promise<Attempt> => {
  const { id } = tombstone;
  if (!file.revivesDeleted) {
    return { id, status: 'deleted', duplicate: true, fileRestored: false };
  }
  if (!(await stillIn(tx, tombstone))) return undefined;
  await storage.put(file.storageKey, file.bytes);
  await tx
    .update(documents)
    .set({
      status: 'received',
      mime: file.mime,
      originalName: file.filename,
      source: file.source,
      hint: file.hint ?? null,
      private: file.private,
      watchRequeues: 0,
      fileDeletedAt: null,
      ...storedFile(file),
      ingestedAt: sql`now()`,
    })
    .where(and(eq(documents.id, id), eq(documents.status, tombstone.status)));
  await queueProcessing(tx, id);
  return { id, status: 'received', duplicate: false, fileRestored: false };
};

// The watched folder hands every file back at each restart. Queueing a failed document
// again each time would spend model calls without end on one that cannot succeed, so
// the folder gets a bounded number of tries. An upload or an MCP call is a person
// asking: it always queues, and gives the folder its tries back.
const mayRequeue = (source: DocumentSource) =>
  source === 'watch' ? lt(documents.watchRequeues, MAX_WATCH_REQUEUES) : undefined;

const requeueCount = (source: DocumentSource) =>
  source === 'watch' ? sql`${documents.watchRequeues} + 1` : 0;

// Whether the bytes at hand go to the storage: a stored copy always wins over a reference,
// so a document kept at a source takes the bytes of a copy, and a stored file that was
// lost is written again from whatever brought its bytes back.
const writesBytes = async (
  storage: Storage,
  existing: ExistingDocument,
  file: IncomingFile,
): Promise<boolean> =>
  existing.fileAtSource ? !file.byReference : !(await storage.exists(file.storageKey));

// The bytes at hand are those of the document, by their hash: handing them back is
// the way to repair a stored file that was lost, and to try a failed document again.
const repairLiveDocument = async (
  tx: Transaction,
  storage: Storage,
  existing: ExistingDocument,
  file: IncomingFile,
): Promise<Attempt> => {
  const { id, status } = existing;
  if (file.private) {
    await tx
      .update(documents)
      .set({ private: true })
      .where(and(eq(documents.id, id), isLiveDocument));
  }
  const writes = await writesBytes(storage, existing, file);
  if (!writes && status !== 'failed') {
    return { id, status, duplicate: true, fileRestored: false };
  }
  // The storage was asked without any lock on the row: a deletion may have committed
  // meanwhile, and its tombstone must neither get its file back nor be queued again.
  if (!(await stillIn(tx, existing))) return undefined;
  if (writes) {
    await storage.put(file.storageKey, file.bytes);
    await tx.update(documents).set(storedFile(file)).where(eq(documents.id, id));
  }
  const unchanged = {
    id,
    status,
    duplicate: true,
    fileRestored: writes && !existing.fileAtSource,
  };
  // A connector reads an item again only when its server renumbered it: not a request to try.
  if (status !== 'failed' || file.source === 'connector') return unchanged;
  const requeued = await requeueFailed(tx, id, {
    watchRequeues: requeueCount(file.source),
    condition: mayRequeue(file.source),
  });
  return requeued ? { ...unchanged, status: 'received' } : unchanged;
};

const ATTEMPTS = 3;

export const ingestExisting = async (
  tx: Transaction,
  storage: Storage,
  existing: ExistingDocument,
  file: IncomingFile,
): Promise<IngestResult> => {
  let current: ExistingDocument | undefined = existing;
  for (let attempt = 0; attempt < ATTEMPTS && current !== undefined; attempt += 1) {
    const result = isLiveStatus(current.status)
      ? await repairLiveDocument(tx, storage, current, file)
      : await reviveTombstone(tx, storage, current, file);
    if (result !== undefined) return result;
    [current] = await tx
      .select({ id: documents.id, status: documents.status, fileAtSource: documents.fileAtSource })
      .from(documents)
      .where(eq(documents.id, existing.id));
  }
  throw new Error('The document kept changing while its bytes were ingested again');
};

export const ingestNew = async (
  tx: Transaction,
  storage: Storage,
  file: IncomingFile,
): Promise<IngestResult> => {
  if (!file.byReference) await storage.put(file.storageKey, file.bytes);
  const [document] = await tx
    .insert(documents)
    .values({
      sha256: file.sha256,
      ...(file.byReference ? { storageKey: null, fileAtSource: true } : storedFile(file)),
      mime: file.mime,
      originalName: file.filename,
      source: file.source,
      hint: file.hint ?? null,
      private: file.private,
    })
    .returning({ id: documents.id, status: documents.status });
  if (document === undefined) throw new Error('The document was not inserted');
  await queueProcessing(tx, document.id);
  return { ...document, duplicate: false, fileRestored: false };
};
