import { DOCUMENT_JOB_FAILURE_CODES, IN_PROGRESS_STATUSES } from '@liasse/contract/domain';
import { and, asc, inArray, notExists } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { pendingProcessingOf } from '../ingest/process-document-job.ts';
import { recordDocumentEvent } from '../processing-log/record.ts';
import { pendingStageOf } from '../processing-log/stage.ts';

const ABANDONED = DOCUMENT_JOB_FAILURE_CODES.stale;

/**
 * For startup. The queue fails the document of a `process_document` job it fails for
 * good, through the hook of the kind, in every process that registered these handlers.
 * This catches what that leaves: a job failed by the recovery of a process that had no
 * handler for the kind, or before the hook existed. Fails the documents on their way that
 * no queued or running job will take further, logs it on each, and returns how many.
 */
export const failAbandonedDocuments = (db: Database): Promise<number> =>
  db.transaction(async (tx) => {
    const pending = pendingProcessingOf(tx, documents.id);
    // Locked in the order of their ids, as every writer of several documents does.
    const abandoned = await tx
      .select({ id: documents.id, status: documents.status, confidence: documents.confidence })
      .from(documents)
      .where(and(inArray(documents.status, IN_PROGRESS_STATUSES), notExists(pending)))
      .orderBy(asc(documents.id))
      .for('update');
    if (abandoned.length === 0) return 0;
    await tx
      .update(documents)
      .set({ status: 'failed', error: ABANDONED })
      .where(
        inArray(
          documents.id,
          abandoned.map(({ id }) => id),
        ),
      );
    for (const document of abandoned) {
      const stage = pendingStageOf(document);
      if (stage === undefined) continue;
      await recordDocumentEvent(tx, document.id, {
        stage,
        outcome: 'failed',
        status: 'failed',
        errorCode: ABANDONED,
      });
    }
    return abandoned.length;
  });
