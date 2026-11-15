import { and, eq, notExists, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { enqueue } from '../jobs/enqueue.ts';
import type { Transaction } from './existing-document.ts';
import { pendingProcessingOf, processDocumentJob } from './process-document-job.ts';

interface Requeue {
  /** The tries the watched folder has used, this one included, as a value or an expression. */
  readonly watchRequeues: number | SQL;
  /** A further condition on the row; the document is left alone when it does not hold. */
  readonly condition?: SQL | undefined;
}

/**
 * Puts a failed document back at the start of the pipeline and queues its processing.
 * False when the document is not failed, or `condition` refused it: nothing is written.
 */
export const requeueFailed = async (
  tx: Transaction,
  documentId: string,
  { watchRequeues, condition }: Requeue,
): Promise<boolean> => {
  const requeued = await tx
    .update(documents)
    .set({ status: 'received', error: null, watchRequeues })
    .where(and(eq(documents.id, documentId), eq(documents.status, 'failed'), condition))
    .returning({ id: documents.id });
  if (requeued.length === 0) return false;
  await enqueue(tx, { kind: processDocumentJob, payload: { documentId } });
  return true;
};

export type RetryOutcome = 'queued' | 'not_failed' | 'not_found';

/**
 * A person asking to process a failed document again, without handing its bytes back.
 * Like an upload of the same file, it gives the watched folder its tries back. A document
 * whose last job has not finished failing yet counts as not failed.
 */
export const retryFailedDocument = (db: Database, documentId: string): Promise<RetryOutcome> =>
  db.transaction(async (tx) => {
    // The job that failed a document writes `failed` before the queue fails the job itself,
    // in another transaction: a retry in between would be failed again by that job's
    // terminal hook, and its new job would find the document failed and stop.
    const queued = await requeueFailed(tx, documentId, {
      watchRequeues: 0,
      condition: notExists(pendingProcessingOf(tx, documentId)),
    });
    if (queued) return 'queued';
    const [live] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), isLiveDocument));
    return live === undefined ? 'not_found' : 'not_failed';
  });
