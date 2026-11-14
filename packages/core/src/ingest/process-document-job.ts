import { z } from 'zod';
import { defineJobKind } from '../jobs/kinds.ts';

/**
 * Queued once per document to process, new or handed back. The pipeline registers its
 * handler with `handle`. The handler reads the document itself, `documents.hint`
 * included, and has nothing to do when the row is gone or is a tombstone
 * (`isLiveStatus`): a document can be deleted while its job is running.
 */
export const processDocumentJob = defineJobKind({
  name: 'process_document',
  schema: z.object({ documentId: z.string().min(1) }),
});
