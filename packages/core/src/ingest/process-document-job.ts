import { z } from 'zod';
import { MAX_HINT_LENGTH } from '../domain/limits.ts';
import { defineJobKind } from '../jobs/kinds.ts';

/**
 * Queued once per new document. The pipeline registers its handler with `handle`.
 * `hint` is what the caller said about the file: untrusted text, to be delimited like
 * the document content wherever it reaches a prompt.
 */
export const processDocumentJob = defineJobKind({
  name: 'process_document',
  schema: z.object({
    documentId: z.string().min(1),
    hint: z.string().min(1).max(MAX_HINT_LENGTH).optional(),
  }),
});
