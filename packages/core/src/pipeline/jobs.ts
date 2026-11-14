import { z } from 'zod';
import { PROCESS_DOCUMENT_MAX_ATTEMPTS } from '../ingest/process-document-job.ts';
import { defineJobKind } from '../jobs/kinds.ts';

const payload = z.object({ documentId: z.string().min(1) });

/**
 * Extracts the fields of a document again from the text stored for it, with the current
 * schema of its type: one text-model call, never a vision call. Queued by consolidation
 * for the documents a type change affects, and by a manual change of type. A document
 * that is not indexed yet is left to `process_document`.
 */
export const reextractDocumentJob = defineJobKind({
  name: 'reextract_document',
  schema: payload,
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
});

/** Computes the chunks of a document again, after a correction changed what they derive from. */
export const reindexDocumentJob = defineJobKind({
  name: 'reindex_document',
  schema: payload,
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
});
