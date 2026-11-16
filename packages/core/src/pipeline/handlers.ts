import {
  DOCUMENT_JOB_FAILURE_CODES,
  type DocumentStatus,
  IN_PROGRESS_STATUSES,
  type ProcessingStage,
} from '@liasse/contract/domain';
import { type FailureTrace, flagDocument, logFailedAttempt } from '../ingest/document-failure.ts';
import {
  PROCESS_DOCUMENT_MAX_ATTEMPTS,
  processDocumentJob,
} from '../ingest/process-document-job.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { handle, type JobContext, type RegisteredHandler } from '../jobs/handlers.ts';
import { ModelProviderError } from '../models/errors.ts';
import type { PipelineDeps } from './deps.ts';
import { SETTLED_STATUSES } from './document.ts';
import { DocumentProcessingError, documentErrorCode, isPermanentFailure } from './errors.ts';
import { reclassifyDocumentJob, reextractDocumentJob, reindexDocumentJob } from './jobs.ts';
import { processDocument, reextractDocument, reindexDocument } from './process-document.ts';
import { reclassifyDocument } from './reclassify-document.ts';

// The class of an error says which defect an `internal_error` is; its message stays out,
// since it may quote the document.
const errorNameOf = (error: unknown): string | undefined =>
  error instanceof Error && /^\w{1,64}$/.test(error.name) ? error.name : undefined;

// A provider failure keeps its identifiers, the model, the HTTP status and the code it
// reported, so that the log says why the call was refused.
const providerTraceOf = (
  error: unknown,
): Pick<FailureTrace, 'model' | 'httpStatus' | 'providerCode'> =>
  error instanceof ModelProviderError
    ? {
        model: error.model,
        ...(error.statusCode === undefined ? {} : { httpStatus: error.statusCode }),
        ...(error.code === undefined ? {} : { providerCode: error.code }),
      }
    : {};

interface Flag {
  readonly from: readonly DocumentStatus[];
  readonly status: DocumentStatus;
  /** The code of the failure when left out. */
  readonly error?: string;
}

interface FailurePolicy {
  /** The executions the queue gives a job of this kind. */
  readonly maxAttempts: number;
  /** Left out: the stage the document waits on. */
  readonly stage?: ProcessingStage;
  /**
   * What the attempt that fails for good writes on a document in one of `from`, in the
   * transaction that logs it. Left out, the document stays as it was.
   */
  readonly flag?: Flag;
}

const traceOf = (error: unknown, attempt: number, policy: FailurePolicy): FailureTrace => {
  const errorName = errorNameOf(error);
  return {
    ...(policy.stage === undefined ? {} : { stage: policy.stage }),
    attempt,
    maxAttempts: policy.maxAttempts,
    errorCode: documentErrorCode(error),
    ...(errorName === undefined ? {} : { errorName }),
    ...providerTraceOf(error),
    retryable: !isPermanentFailure(error),
  };
};

// Every attempt that fails is logged on its document; the last one also flags it, in
// the same transaction. An interrupted job is given back to the queue without counting,
// so it logs nothing. A failure another attempt cannot fix ends the job at once.
const loggingFailures =
  <Payload extends { readonly documentId: string }>(
    deps: PipelineDeps,
    policy: FailurePolicy,
    run: (job: JobContext<Payload>) => Promise<void>,
  ) =>
  async (job: JobContext<Payload>): Promise<void> => {
    const { payload, signal, attempt } = job;
    try {
      await run(job);
    } catch (error) {
      if (signal.aborted) throw error;
      const permanent = isPermanentFailure(error);
      const trace = traceOf(error, attempt, policy);
      const code = documentErrorCode(error);
      const final = permanent || attempt >= policy.maxAttempts;
      const { flag } = policy;
      const flagged =
        final &&
        flag !== undefined &&
        (await flagDocument(
          deps.db,
          payload.documentId,
          flag.from,
          flag.status,
          flag.error ?? code,
          trace,
        ));
      if (!flagged) {
        await logFailedAttempt(deps.db, payload.documentId, final ? 'failed' : 'retrying', trace);
      }
      throw permanent && !(error instanceof PermanentJobError)
        ? new DocumentProcessingError(code, { cause: error })
        : error;
    }
  };

// A document must not stay on its way for ever: when its job will not run again, it
// ends `failed` with the code of what stopped it.
const failingTheDocument: FailurePolicy = {
  maxAttempts: processDocumentJob.maxAttempts ?? PROCESS_DOCUMENT_MAX_ATTEMPTS,
  flag: { from: IN_PROGRESS_STATUSES, status: 'failed' },
};

// A re-extraction that never succeeds leaves the document indexed and queryable, flagged
// for review; its log keeps the code of what stopped it.
const flaggingForReview: FailurePolicy = {
  maxAttempts: reextractDocumentJob.maxAttempts ?? PROCESS_DOCUMENT_MAX_ATTEMPTS,
  stage: 'reextraction',
  flag: {
    from: SETTLED_STATUSES,
    status: 'needs_review',
    error: DOCUMENT_JOB_FAILURE_CODES.reextraction,
  },
};

// A reclassification that never succeeds leaves the document as it was: the type a
// person rejected stays until they correct it or ask again.
const reclassifying: FailurePolicy = {
  maxAttempts: reclassifyDocumentJob.maxAttempts ?? PROCESS_DOCUMENT_MAX_ATTEMPTS,
  stage: 'classification',
};

// A re-indexing that never succeeds leaves the document as it was.
const reindexing: FailurePolicy = {
  maxAttempts: reindexDocumentJob.maxAttempts ?? PROCESS_DOCUMENT_MAX_ATTEMPTS,
  stage: 'indexing',
};

/**
 * The job handlers of the pipeline, for `startWorkers`. Only `process_document` fails a
 * document; a re-extraction that fails for good flags it for review, and a
 * reclassification or a re-indexing leaves it as it was.
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
    loggingFailures(deps, flaggingForReview, ({ payload, signal }) =>
      reextractDocument(deps, payload.documentId, signal),
    ),
  ),
  handle(
    reclassifyDocumentJob,
    loggingFailures(deps, reclassifying, ({ payload, signal }) =>
      reclassifyDocument(deps, payload, signal),
    ),
  ),
  handle(
    reindexDocumentJob,
    loggingFailures(deps, reindexing, ({ payload }) => reindexDocument(deps, payload.documentId)),
  ),
];
