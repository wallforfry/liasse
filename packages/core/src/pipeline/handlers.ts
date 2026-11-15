import {
  type DocumentStatus,
  IN_PROGRESS_STATUSES,
  type ProcessingStage,
} from '@liasse/contract/domain';
import {
  PROCESS_DOCUMENT_MAX_ATTEMPTS,
  processDocumentJob,
} from '../ingest/process-document-job.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { handle, type JobContext, type RegisteredHandler } from '../jobs/handlers.ts';
import type { PipelineDeps } from './deps.ts';
import { type FailureTrace, flagDocument, logFailedAttempt } from '../ingest/document-failure.ts';
import { DocumentProcessingError, documentErrorCode, isPermanentFailure } from './errors.ts';
import { reextractDocumentJob, reindexDocumentJob } from './jobs.ts';
import { processDocument, reextractDocument, reindexDocument } from './process-document.ts';

type DocumentJob = JobContext<{ readonly documentId: string }>;

// The class of an error says which defect an `internal_error` is; its message stays out,
// since it may quote the document.
const errorNameOf = (error: unknown): string | undefined =>
  error instanceof Error && /^\w{1,64}$/.test(error.name) ? error.name : undefined;

interface FailurePolicy {
  /** Left out: the stage the document waits on. */
  readonly stage?: ProcessingStage;
  /**
   * The attempt that fails for good gives a document in one of `from` this status, with
   * its code as the error, and logs it in the same transaction.
   */
  readonly flag?: { readonly from: readonly DocumentStatus[]; readonly status: DocumentStatus };
}

const traceOf = (
  error: unknown,
  attempt: number,
  stage: ProcessingStage | undefined,
): FailureTrace => {
  const errorName = errorNameOf(error);
  return {
    ...(stage === undefined ? {} : { stage }),
    attempt,
    maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
    errorCode: documentErrorCode(error),
    ...(errorName === undefined ? {} : { errorName }),
    retryable: !isPermanentFailure(error),
  };
};

// Every attempt that fails is logged on its document; the last one also flags it, in
// the same transaction. An interrupted job is given back to the queue without counting,
// so it logs nothing. A failure another attempt cannot fix ends the job at once.
const loggingFailures =
  (deps: PipelineDeps, policy: FailurePolicy, run: (job: DocumentJob) => Promise<void>) =>
  async (job: DocumentJob): Promise<void> => {
    const { payload, signal, attempt } = job;
    try {
      await run(job);
    } catch (error) {
      if (signal.aborted) throw error;
      const permanent = isPermanentFailure(error);
      const trace = traceOf(error, attempt, policy.stage);
      const code = documentErrorCode(error);
      const final = permanent || attempt >= PROCESS_DOCUMENT_MAX_ATTEMPTS;
      const { flag } = policy;
      const flagged =
        final &&
        flag !== undefined &&
        (await flagDocument(deps.db, payload.documentId, flag.from, flag.status, code, trace));
      if (!flagged) {
        await logFailedAttempt(deps.db, payload.documentId, final ? 'failed' : 'retrying', trace);
      }
      throw permanent && !(error instanceof PermanentJobError)
        ? new DocumentProcessingError(code)
        : error;
    }
  };

// A document must not stay on its way for ever: when its job will not run again, it
// ends `failed` with the code of what stopped it.
const failingTheDocument: FailurePolicy = {
  flag: { from: IN_PROGRESS_STATUSES, status: 'failed' },
};

// A re-extraction that never succeeds is flagged for review by the hook of its kind, in
// the transaction that fails its job.
const reextracting: FailurePolicy = { stage: 'reextraction' };

// A re-indexing that never succeeds leaves the document as it was.
const reindexing: FailurePolicy = { stage: 'indexing' };

/**
 * The job handlers of the pipeline, for `startWorkers`. A re-extraction or a re-indexing
 * that fails leaves the document as it was: only `process_document` fails a document.
 */
export const createPipelineHandlers = (deps: PipelineDeps): readonly RegisteredHandler[] => [
  handle(
    processDocumentJob,
    loggingFailures(deps, failingTheDocument, ({ payload, signal }) =>
      processDocument(deps, payload.documentId, signal),
    ),
  ),
  handle(
    reextractDocumentJob,
    loggingFailures(deps, reextracting, ({ payload, signal }) =>
      reextractDocument(deps, payload.documentId, signal),
    ),
  ),
  handle(
    reindexDocumentJob,
    loggingFailures(deps, reindexing, ({ payload }) => reindexDocument(deps, payload.documentId)),
  ),
];
