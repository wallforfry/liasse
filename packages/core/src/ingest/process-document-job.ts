import { DOCUMENT_JOB_FAILURE_CODES } from '@liasse/contract/domain';
import { z } from 'zod';
import { defineJobKind } from '../jobs/kinds.ts';
import { documentOfPayload, failDocumentInProgress } from './document-failure.ts';

// One model call already makes up to three provider attempts, with a backoff, inside
// its own time limit: three executions of the job are at most nine attempts per call,
// and a failure the provider says is final ends the job at the first.
export const PROCESS_DOCUMENT_MAX_ATTEMPTS = 3;

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
 *
 * When the queue fails the job for good, by whatever path, a document still on its way
 * ends `failed`: without it nothing would ever take it further. A handler that knows a
 * more precise code writes it first; this leaves it as it is.
 */
export const processDocumentJob = defineJobKind({
  name: 'process_document',
  schema: z.object({ documentId: z.string().min(1) }),
  maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
  onTerminalFailure: async (tx, { payload, cause, attempt }) => {
    const documentId = documentOfPayload(payload);
    if (documentId === undefined) return;
    await failDocumentInProgress(tx, documentId, DOCUMENT_JOB_FAILURE_CODES[cause], {
      attempt,
      maxAttempts: PROCESS_DOCUMENT_MAX_ATTEMPTS,
    });
  },
});
