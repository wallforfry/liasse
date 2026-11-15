import { retryFailedDocument } from '../ingest/requeue-failed.ts';
import type { ApiContext } from './context.ts';
import { ApiError, documentNotFound } from './errors.ts';

/**
 * Queues a failed document for processing again, from its stored file. Rejects with
 * `document_not_found` for an unknown or deleted document, and with `document_not_failed`
 * for one whose processing did not fail: it is under way or already done.
 */
export const retryDocument = async ({ db }: Pick<ApiContext, 'db'>, id: string): Promise<void> => {
  const outcome = await retryFailedDocument(db, id);
  if (outcome === 'not_found') throw documentNotFound();
  if (outcome === 'not_failed') {
    throw new ApiError(
      'invalid',
      'document_not_failed',
      'Only a document whose processing failed can be processed again.',
    );
  }
};
