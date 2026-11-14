import { z } from 'zod';
import { defineJobKind } from '../jobs/kinds.ts';

/**
 * Queued once per document to process, new or handed back. The pipeline registers its
 * handler with `handle`. The handler reads the document itself, `documents.hint`
 * included.
 *
 * A deletion cancels the jobs still queued, not the one that is running. The handler
 * therefore makes every write to the document, and to the rows derived from it,
 * through `writeIfLive`: it writes nothing once the document is a tombstone, and a
 * deletion that arrives during the write waits for it and then deletes what it wrote.
 * Reads go through `isLiveDocument`. A document that is gone or deleted is no failure:
 * the handler returns.
 */
export const processDocumentJob = defineJobKind({
  name: 'process_document',
  schema: z.object({ documentId: z.string().min(1) }),
});
