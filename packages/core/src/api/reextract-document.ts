import { requestReextraction } from '../pipeline/request-reextraction.ts';
import type { ApiContext } from './context.ts';
import { ApiError, documentNotFound } from './errors.ts';

/**
 * Queues the values of a settled document to be extracted again from its stored text, for
 * the type it has: its type is neither changed nor decided again, and the values corrected
 * by hand are kept. Rejects with `document_not_found` for an unknown or deleted document,
 * and with `document_not_settled` for one still on its way, failed, or with a processing,
 * re-extraction or reclassification still pending.
 */
export const reextractDocument = async (
  { db }: Pick<ApiContext, 'db'>,
  id: string,
): Promise<void> => {
  const outcome = await requestReextraction(db, id);
  if (outcome === 'not_found') throw documentNotFound();
  if (outcome === 'not_settled') {
    throw new ApiError(
      'document_not_settled',
      'Only an indexed document, or one flagged for review, with no processing pending can have its values extracted again.',
    );
  }
};
