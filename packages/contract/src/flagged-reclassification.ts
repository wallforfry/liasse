import { z } from 'zod';
import { TYPE_REVIEW_REASONS } from './domain/enums.ts';

export const DEFAULT_FLAGGED_RECLASSIFICATION_LIMIT = 100;
export const MAX_FLAGGED_RECLASSIFICATION_LIMIT = 100;

// A request to decide again, in one action, the type of the documents flagged for review
// for how their type was decided.
export const flaggedReclassificationSchema = z.strictObject({
  reason: z
    .enum(TYPE_REVIEW_REASONS)
    .describe(
      'The review reason of the documents to reclassify: `type_untyped` for those left ' +
        'without a type, `type_fallback` for those given the closest type.',
    ),
  limit: z
    .int()
    .min(1)
    .max(MAX_FLAGGED_RECLASSIFICATION_LIMIT)
    .default(DEFAULT_FLAGGED_RECLASSIFICATION_LIMIT)
    .describe('The most documents queued by this request; oldest first.'),
});
export type FlaggedReclassification = z.input<typeof flaggedReclassificationSchema>;

export const flaggedReclassificationResultSchema = z.strictObject({
  queued: z.int().min(0).describe('Documents whose type is now being decided again.'),
  skipped: z
    .int()
    .min(0)
    .describe(
      'Documents with the reason that were left alone: a job that rewrites their type or ' +
        'values was already queued or running, or they changed while the request ran.',
    ),
  remaining: z
    .int()
    .min(0)
    .describe('Documents with the reason, free to be queued, beyond `limit`: ask again.'),
});
export type FlaggedReclassificationResult = z.output<typeof flaggedReclassificationResultSchema>;
