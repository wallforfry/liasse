import { DOCUMENT_JOB_FAILURE_CODES } from '@liasse/contract/domain';
import { z } from 'zod';
import { documentOfPayload, flagDocument } from '../ingest/document-failure.ts';
import { PROCESS_DOCUMENT_MAX_ATTEMPTS } from '../ingest/process-document-job.ts';
import { defineJobKind } from '../jobs/kinds.ts';
import { SETTLED_STATUSES } from './document.ts';

const payload = z.object({ documentId: z.string().min(1) });

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
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
  // The handler logs the attempt that failed with its code; this logs a worker that died.
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
        ? { stage: 'reextraction', attempt, maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS }
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
