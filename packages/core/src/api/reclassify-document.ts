import type { DocumentReclassification } from '@liasse/contract';
import { requestReclassification } from '../pipeline/request-reclassification.ts';
import type { ApiContext } from './context.ts';
import { ApiError, documentNotFound } from './errors.ts';

/**
 * Queues the type of a settled document to be decided again, without the type it has.
 * Rejects with `document_not_found` for an unknown or deleted document, and with
 * `document_not_settled` for one still on its way, failed, or with a processing,
 * re-extraction or reclassification still pending.
 */
export const reclassifyDocument = async (
  { db }: Pick<ApiContext, 'db'>,
  id: string,
  { hint, new_type: newType }: DocumentReclassification = {},
): Promise<void> => {
  const outcome = await requestReclassification(db, id, { hint, newType });
  if (outcome === 'not_found') throw documentNotFound();
  if (outcome === 'not_settled') {
    throw new ApiError(
      'document_not_settled',
      'Only an indexed document, or one flagged for review, with no processing pending can have its type decided again.',
    );
  }
};
