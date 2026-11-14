import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import {
  type DocumentSource,
  type DocumentStatus,
  isLiveStatus,
  type SupportedMime,
} from '../domain/enums.ts';
import { enqueue } from '../jobs/enqueue.ts';
import type { StorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { processDocumentJob } from './process-document-job.ts';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A file that passed the checks of ingestion, ready to be stored. */
export interface IncomingFile {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly storageKey: StorageKey;
  readonly mime: SupportedMime;
  readonly filename: string;
  readonly source: DocumentSource;
  readonly hint: string | undefined;
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
}

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

// A file still lying in the watched folder is seen again at every restart: that is no
// request to undo a deletion. An upload or an MCP call is one.
const reviveTombstone = async (
  tx: Transaction,
  storage: Storage,
  tombstone: ExistingDocument,
  file: IncomingFile,
): Promise<Attempt> => {
  const { id } = tombstone;
  if (file.source === 'watch') {
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
      ingestedAt: sql`now()`,
    })
    .where(and(eq(documents.id, id), eq(documents.status, tombstone.status)));
  await queueProcessing(tx, id);
  return { id, status: 'received', duplicate: false, fileRestored: false };
};

// The bytes at hand are those of the document, by their hash: handing them back is
// the way to repair a stored file that was lost, and to try a failed document again.
const repairLiveDocument = async (
  tx: Transaction,
  storage: Storage,
  existing: ExistingDocument,
  file: IncomingFile,
): Promise<Attempt> => {
  const { id, status } = existing;
  const fileMissing = !(await storage.exists(file.storageKey));
  if (!fileMissing && status !== 'failed') {
    return { id, status, duplicate: true, fileRestored: false };
  }
  // The storage was asked without any lock on the row: a deletion may have committed
  // meanwhile, and its tombstone must neither get its file back nor be queued again.
  if (!(await stillIn(tx, existing))) return undefined;
  if (fileMissing) await storage.put(file.storageKey, file.bytes);
  if (status !== 'failed') return { id, status, duplicate: true, fileRestored: fileMissing };
  await tx
    .update(documents)
    .set({ status: 'received', error: null })
    .where(and(eq(documents.id, id), eq(documents.status, status)));
  await queueProcessing(tx, id);
  return { id, status: 'received', duplicate: true, fileRestored: fileMissing };
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
      .select({ id: documents.id, status: documents.status })
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
  await storage.put(file.storageKey, file.bytes);
  const [document] = await tx
    .insert(documents)
    .values({
      sha256: file.sha256,
      storageKey: file.storageKey,
      mime: file.mime,
      originalName: file.filename,
      source: file.source,
      hint: file.hint ?? null,
    })
    .returning({ id: documents.id, status: documents.status });
  if (document === undefined) throw new Error('The document was not inserted');
  await queueProcessing(tx, document.id);
  return { ...document, duplicate: false, fileRestored: false };
};
