import type { DocumentView, LiasseClient } from '@liasse/sdk';
import { UiRefusal } from '../../api/errors.ts';
import { draftOfReview, readReview } from './review.ts';

/**
 * Settles the review of a document without looking at it: the review panel sent with every
 * value accepted and the type kept, read from the document as it is now.
 */
export const acceptReview = async (client: LiasseClient, id: string): Promise<DocumentView> => {
  const document = await client.getDocument(id, { include: ['fields', 'review'] });
  if (document.status !== 'needs_review' || document.review === undefined) {
    throw new UiRefusal('The document is no longer to review.');
  }
  if (document.analysis_pending) {
    throw new UiRefusal('The document is being analysed again.');
  }
  const reading = readReview(draftOfReview(document), document, document.review);
  if (!reading.ok) throw new UiRefusal(reading.problem);
  return client.correctDocument(id, reading.correction);
};
