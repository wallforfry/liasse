import { and, eq, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { chunks, documentPages, documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { documentDates, documentLinks, facts } from '../db/schema/knowledge.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { deleteFileJob } from './delete-file-job.ts';
import type { Transaction } from './existing-document.ts';
import { isLiveDocument } from './live-document.ts';
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
} as const;

// The row stays, so the cascade of its foreign keys does not run. A table that
// references `documents` must be emptied here.
const deleteDerivedRows = async (tx: Transaction, id: string): Promise<void> => {
  await tx.delete(documentPages).where(eq(documentPages.documentId, id));
  await tx.delete(chunks).where(eq(chunks.documentId, id));
  await tx.delete(documentDates).where(eq(documentDates.documentId, id));
  await tx.delete(facts).where(eq(facts.documentId, id));
  await tx
    .delete(documentLinks)
    .where(or(eq(documentLinks.fromDocumentId, id), eq(documentLinks.toDocumentId, id)));
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
 */
export const deleteDocument = ({ db }: DeleteDocumentDeps, id: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    const [tombstone] = await tx
      .update(documents)
      .set(BLANK_CONTENT)
      .where(and(eq(documents.id, id), isLiveDocument))
      .returning({ id: documents.id });
    if (tombstone === undefined) return false;
    await deleteDerivedRows(tx, id);
    await cancelQueuedProcessing(tx, id);
    await enqueue(tx, { kind: deleteFileJob, payload: { documentId: id } });
    return true;
  });
