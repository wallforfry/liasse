import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentEvents } from '../db/schema/document-events.ts';
import { chunks, documentPages, documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs, unfinishedJobOfDocument } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts } from '../db/schema/knowledge.ts';
import { documentOrigins } from '../db/schema/sources.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { lockLinkedDocuments, recomputeDocumentStates } from '../knowledge/document-state.ts';
import { withSubjectLock } from '../knowledge/subject-lock.ts';
import { blankOrphanSubjects } from '../knowledge/subject-orphans.ts';
import { deleteFileJob } from './delete-file-job.ts';
import type { Transaction } from './existing-document.ts';
import { lockFile } from './file-lock.ts';
import { processDocumentJob } from './process-document-job.ts';

export interface DeletedDocument {
  readonly id: string;
}

export interface DeleteDocumentDeps {
  readonly db: Database;
  /**
   * Runs in the transaction of the deletion, once the document is a tombstone, for what
   * must follow it outside Liasse. What it queues commits with the deletion, and what
   * it throws undoes the deletion.
   */
  readonly onDeleted?: (tx: Transaction, document: DeletedDocument) => Promise<void>;
}

// Everything that says what the document was. The hash and the storage key stay: the
// first recognises the same bytes later, the second is what `delete_file` removes, or
// null with `file_at_source` for a file that stayed at its source, which nothing removes.
// `hindsight_held_since` stays as well: it says nothing of the content, and it is the
// only trace that Hindsight may still hold facts of the document and owes a forget.
// `hindsight_retain_until` stays with it: a retain in flight may still land.
const BLANK_CONTENT = {
  status: 'deleted',
  state: 'current',
  originalName: '',
  hint: null,
  reclassificationHint: null,
  rejectedTypeIds: [],
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
  noticePeriod: null,
  watchRequeues: 0,
  fileDeletedAt: null,
  replacedBySource: false,
  hindsightSentHash: null,
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
  documentEvents.documentId,
  documentOrigins.documentId,
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
        unfinishedJobOfDocument(id),
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
 * computed again in the same transaction, so none stays superseded by a tombstone. A
 * subject no live document concerns any more is blanked. Both are writes of subject and
 * document rows: they run under the subject lock, taken after the lock of the hash and
 * before any row, as every writer of a document and its subjects takes them.
 */
export interface DeleteDocumentOptions {
  /**
   * Asked once the lock of the hash is held, before anything changes: false leaves the
   * document as it is, and what the callback wrote commits. No ingestion of the same bytes
   * can change the document between its answer and the deletion.
   */
  readonly when?: (tx: Transaction) => Promise<boolean>;
  /**
   * The source that keeps the file now holds another version of it: the tombstone records
   * it, and the same source may bring the document back if the file returns to these bytes.
   */
  readonly replacedBySource?: boolean;
}

export const deleteDocument = (
  { db, onDeleted }: DeleteDocumentDeps,
  id: string,
  { when, replacedBySource = false }: DeleteDocumentOptions = {},
): Promise<boolean> =>
  db.transaction(async (outer) => {
    const [live] = await outer
      .select({ sha256: documents.sha256 })
      .from(documents)
      .where(and(eq(documents.id, id), isLiveDocument));
    if (live === undefined) return false;
    await lockFile(outer, live.sha256);
    if (when !== undefined && !(await when(outer))) return false;
    return withSubjectLock(outer, async (tx) => {
      const linked = await lockLinkedDocuments(tx, id);
      // The row is held from here on: what it says it concerns stays so until the commit.
      const [concerned] = await tx
        .select({ subjectIds: documents.subjectIds })
        .from(documents)
        .where(eq(documents.id, id));
      const [tombstone] = await tx
        .update(documents)
        .set({ ...BLANK_CONTENT, replacedBySource })
        .where(and(eq(documents.id, id), isLiveDocument))
        .returning({ id: documents.id });
      if (tombstone === undefined) return false;
      await deleteDerivedRows(tx, id);
      await recomputeDocumentStates(tx, linked);
      await blankOrphanSubjects(tx, concerned?.subjectIds ?? []);
      await cancelQueuedProcessing(tx, id);
      await enqueue(tx, { kind: deleteFileJob, payload: { documentId: id } });
      await onDeleted?.(tx, { id });
      return true;
    });
  });
