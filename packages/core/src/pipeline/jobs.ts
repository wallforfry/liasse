import { DOCUMENT_JOB_FAILURE_CODES, SETTLED_STATUSES } from '@liasse/contract/domain';
import { z } from 'zod';
import { documentOfPayload, flagDocument, logFailedAttempt } from '../ingest/document-failure.ts';
import { PROCESS_DOCUMENT_MAX_ATTEMPTS } from '../ingest/process-document-job.ts';
import { defineJobKind } from '../jobs/kinds.ts';

const payload = z.object({ documentId: z.string().min(1) });

const REEXTRACT_MAX_ATTEMPTS = PROCESS_DOCUMENT_MAX_ATTEMPTS;

/**
 * Extracts the fields of a document again from the text stored for it, with the current
 * schema of its type: one text-model call, never a vision call. Queued by consolidation
 * for the documents a type change affects, and by a manual change of type. A document
 * that is not indexed yet is left to `process_document`.
 *
 * A re-extraction that never succeeds leaves the document indexed and queryable, but
 * flagged for review with a code: what it owes stays recorded on the document itself
 * (`confidence` and `schema_version` stay null until an extraction succeeds).
 */
export const reextractDocumentJob = defineJobKind({
  name: 'reextract_document',
  schema: payload,
  maxAttempts: REEXTRACT_MAX_ATTEMPTS,
  // The handler flags and logs the attempt that failed with its code, in one transaction.
  // This flags what no handler did, and logs it when a worker died.
  onTerminalFailure: async (tx, { payload, cause, attempt }) => {
    const documentId = documentOfPayload(payload);
    if (documentId === undefined) return;
    await flagDocument(
      tx,
      documentId,
      SETTLED_STATUSES,
      'needs_review',
      DOCUMENT_JOB_FAILURE_CODES.reextraction,
      cause === 'stale'
        ? {
            stage: 'reextraction',
            attempt,
            maxAttempts: REEXTRACT_MAX_ATTEMPTS,
            errorCode: DOCUMENT_JOB_FAILURE_CODES.stale,
          }
        : undefined,
    );
  },
});

/** Computes the chunks of a document again, after a correction changed what they derive from. */
export const reindexDocumentJob = defineJobKind({
  name: 'reindex_document',
  schema: payload,
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
});

const reclassifyPayload = z.object({
  documentId: z.string().min(1),
  rejectedTypeId: z.string().min(1).nullable(),
  newType: z.boolean(),
});
export type ReclassifyPayload = z.output<typeof reclassifyPayload>;

/**
 * Decides the type of a settled document again, because a person said the one it has
 * is wrong: `rejectedTypeId` is that type (null for a document without one), `newType`
 * whether only a new type will do. What the person added is free text: it waits on the
 * document, in `documents.reclassification_hint`, which a deletion blanks, while a job
 * row outlives its document. A document whose type is no longer the rejected one, a
 * correction or a merge having come in between, is left alone. A reclassification that
 * fails for good leaves the document as it was.
 */
export const reclassifyDocumentJob = defineJobKind({
  name: 'reclassify_document',
  schema: reclassifyPayload,
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
  // The handler logs the attempt that failed. This logs the one a dead worker could not,
  // so that whoever follows the log sees the reclassification end.
  onTerminalFailure: async (tx, { payload, cause, attempt }) => {
    const documentId = documentOfPayload(payload);
    if (cause !== 'stale' || documentId === undefined) return;
    await logFailedAttempt(tx, documentId, 'failed', {
      stage: 'classification',
      attempt,
      maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
      errorCode: DOCUMENT_JOB_FAILURE_CODES.stale,
    });
  },
});
