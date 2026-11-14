import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import type { SupportedMime, DocumentSource, DocumentStatus } from '../domain/enums.ts';
import { enqueue } from '../jobs/enqueue.ts';
import type { StorageKey } from '../storage/key.ts';
import type { Storage } from '../storage/port.ts';
import { isLiveStatus } from './live-document.ts';
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

// A file still lying in the watched folder is seen again at every restart: that is no
// request to undo a deletion. An upload or an MCP call is one.
const reviveTombstone = async (
  tx: Transaction,
  storage: Storage,
  { id }: ExistingDocument,
  file: IncomingFile,
): Promise<IngestResult> => {
  if (file.source === 'watch') {
    return { id, status: 'deleted', duplicate: true, fileRestored: false };
  }
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
    .where(eq(documents.id, id));
  await queueProcessing(tx, id);
  return { id, status: 'received', duplicate: false, fileRestored: false };
};

// The bytes at hand are those of the document, by their hash: handing them back is
// the way to repair a stored file that was lost, and to try a failed document again.
const repairLiveDocument = async (
  tx: Transaction,
  storage: Storage,
  { id, status }: ExistingDocument,
  file: IncomingFile,
): Promise<IngestResult> => {
  const fileRestored = !(await storage.exists(file.storageKey));
  if (fileRestored) await storage.put(file.storageKey, file.bytes);
  if (status !== 'failed') return { id, status, duplicate: true, fileRestored };
  await tx.update(documents).set({ status: 'received', error: null }).where(eq(documents.id, id));
  await queueProcessing(tx, id);
  return { id, status: 'received', duplicate: true, fileRestored };
};

export const ingestExisting = (
  tx: Transaction,
  storage: Storage,
  existing: ExistingDocument,
  file: IncomingFile,
): Promise<IngestResult> =>
  isLiveStatus(existing.status)
    ? repairLiveDocument(tx, storage, existing, file)
    : reviveTombstone(tx, storage, existing, file);

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
