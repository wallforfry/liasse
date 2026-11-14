import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts } from '../db/schema/knowledge.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { lockLinkedDocuments, recomputeDocumentStates } from '../knowledge/document-state.ts';
import { deleteFileJob } from './delete-file-job.ts';
import type { Transaction } from './existing-document.ts';
import { lockFile } from './file-lock.ts';
import { processDocumentJob } from './process-document-job.ts';

export interface DeleteDocumentDeps {
  readonly db: Database;
}

// Everything that says what the document was. The hash and the storage key stay: the
// first recognises the same bytes later, the second is what `delete_file` removes.
const BLANK_CONTENT = {
  status: 'deleted',
  state: 'current',
  originalName: '',
  hint: null,
  typeId: null,
  schemaVersion: null,
  core: {},
  fields: {},
  extra: {},
  provenance: {},
  title: null,
  summary: null,
  private: false,
  error: null,
  confidence: null,
  manualFields: [],
  subjectIds: [],
  watchRequeues: 0,
  fileDeletedAt: null,
} as const;

/**
 * Every column that references `documents.id`. The row of a deleted document stays, so
 * the cascade of these foreign keys does not run: `deleteDocument` deletes through this
 * list instead. A test compares it with the foreign keys of the Postgres catalog, so a
 * new table that references `documents` fails until it is listed here.
 */
export const DOCUMENT_REFERENCES = [
  documentPages.documentId,
  chunks.documentId,
  documentDates.documentId,
  facts.documentId,
  documentLinks.fromDocumentId,
  documentLinks.toDocumentId,
] as const;

const deleteDerivedRows = async (tx: Transaction, id: string): Promise<void> => {
  for (const reference of DOCUMENT_REFERENCES) {
    await tx.delete(reference.table).where(eq(reference, id));
  }
};

const cancelQueuedProcessing = async (tx: Transaction, id: string): Promise<void> => {
  await tx
    .delete(jobs)
    .where(
      and(
        eq(jobs.kind, processDocumentJob.name),
        eq(jobs.status, 'queued'),
        sql`${jobs.payload}->>'documentId' = ${id}`,
      ),
    );
};

/**
 * Deletes a document. Resolves to false when it does not exist or is already deleted.
 *
 * In one transaction the derived rows go, the row becomes a tombstone without content
 * and a `delete_file` job is queued, so the stored file is removed with the retries
 * of the queue and a storage outage cannot leave it behind. The tombstone is what
 * keeps a file still lying in the watched folder from being ingested again.
 *
 * It takes the lock of the file's hash first, as ingestion does. An ingestion of the
 * same bytes in progress, which may be about to queue the document again, therefore
 * commits before the deletion looks at the document, and the deletion undoes it.
 *
 * The links of the document go with it, and the state of a document rests on the links
 * that point at it: the documents this one superseded or terminated get their state
 * computed again in the same transaction, so none stays superseded by a tombstone.
 */
export const deleteDocument = ({ db }: DeleteDocumentDeps, id: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    const [live] = await tx
      .select({ sha256: documents.sha256 })
      .from(documents)
      .where(and(eq(documents.id, id), isLiveDocument));
    if (live === undefined) return false;
    await lockFile(tx, live.sha256);
    const linked = await lockLinkedDocuments(tx, id);
    const [tombstone] = await tx
      .update(documents)
      .set(BLANK_CONTENT)
      .where(and(eq(documents.id, id), isLiveDocument))
      .returning({ id: documents.id });
    if (tombstone === undefined) return false;
    await deleteDerivedRows(tx, id);
    await recomputeDocumentStates(tx, linked);
    await cancelQueuedProcessing(tx, id);
    await enqueue(tx, { kind: deleteFileJob, payload: { documentId: id } });
    return true;
  });
