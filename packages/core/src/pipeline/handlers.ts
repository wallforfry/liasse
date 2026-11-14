import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { IN_PROGRESS_STATUSES } from '../domain/enums.ts';
import {
  PROCESS_DOCUMENT_MAX_ATTEMPTS,
  processDocumentJob,
} from '../ingest/process-document-job.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { handle, type JobContext, type RegisteredHandler } from '../jobs/handlers.ts';
import type { PipelineDeps } from './deps.ts';
import { markDocumentFailed } from './document.ts';
import {
  DocumentProcessingError,
  documentErrorCode,
  isPermanentFailure,
  type PipelineErrorCode,
} from './errors.ts';
import { reextractDocumentJob, reindexDocumentJob } from './jobs.ts';
import { processDocument, reextractDocument, reindexDocument } from './process-document.ts';

type DocumentJob = JobContext<{ readonly documentId: string }>;

// A document must not stay on its way for ever: when its job will not run again, it
// ends `failed` with the code of what stopped it. An interrupted job is given back to
// the queue without counting, so it marks nothing.
const failingTheDocument =
  (deps: PipelineDeps) =>
  async ({ payload: { documentId }, signal, attempt }: DocumentJob): Promise<void> => {
    try {
      await processDocument(deps, documentId, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      const permanent = isPermanentFailure(error);
      if (permanent || attempt >= PROCESS_DOCUMENT_MAX_ATTEMPTS) {
        await markDocumentFailed(deps.db, documentId, documentErrorCode(error));
      }
      throw permanent && !(error instanceof PermanentJobError)
        ? new DocumentProcessingError(documentErrorCode(error))
        : error;
    }
  };

/**
 * The job handlers of the pipeline, for `startWorkers`. A re-extraction or a re-indexing
 * that fails leaves the document as it was: only `process_document` fails a document.
 */
export const createPipelineHandlers = (deps: PipelineDeps): readonly RegisteredHandler[] => [
  handle(processDocumentJob, failingTheDocument(deps)),
  handle(reextractDocumentJob, ({ payload, signal }) =>
    reextractDocument(deps, payload.documentId, signal),
  ),
  handle(reindexDocumentJob, ({ payload }) => reindexDocument(deps, payload.documentId)),
];

const ABANDONED = 'processing_abandoned' satisfies PipelineErrorCode;

/**
 * For startup. A worker that dies during a job never runs the code that fails the
 * document, and the queue fails the job by itself once its attempts are spent: the
 * document would stay `received`, `extracted` or `classified` with nothing left to move
 * it. Fails the documents on their way that no queued or running job will take further,
 * and returns how many.
 */
export const failAbandonedDocuments = async (db: Database): Promise<number> => {
  const pending = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, processDocumentJob.name),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.payload}->>'documentId' = ${documents.id}`,
      ),
    );
  const failed = await db
    .update(documents)
    .set({ status: 'failed', error: ABANDONED })
    .where(and(inArray(documents.status, IN_PROGRESS_STATUSES), notExists(pending)))
    .returning({ id: documents.id });
  return failed.length;
};
