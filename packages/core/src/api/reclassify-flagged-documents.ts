import {
  type FlaggedReclassification,
  type FlaggedReclassificationResult,
  flaggedReclassificationSchema,
} from '@liasse/contract';
import { requestFlaggedReclassifications } from '../pipeline/reclassify-flagged.ts';
import type { ApiContext } from './context.ts';

/**
 * Queues the type of the documents flagged for review with a type reason to be decided
 * again, at most `limit` of them, as `reclassifyDocument` does for one, private ones
 * included. Those a job is about to rewrite are skipped and counted, never refused: the
 * answer counts what was queued, skipped, and is left for another request.
 */
export const reclassifyFlaggedDocuments = async (
  { db }: Pick<ApiContext, 'db'>,
  request: FlaggedReclassification,
): Promise<FlaggedReclassificationResult> => {
  const { reason, limit } = flaggedReclassificationSchema.parse(request);
  return requestFlaggedReclassifications(db, reason, limit);
};
