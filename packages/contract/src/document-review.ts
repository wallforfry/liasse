import { z } from 'zod';
import { CLASSIFICATION_OUTCOMES, REVIEW_REASONS, VALUE_SECTIONS } from './domain/enums.ts';

const confidenceSchema = z.number().min(0).max(1);

const reviewedTypeSchema = z.object({
  confidence: confidenceSchema.nullable().describe('Of the classification; null when unknown.'),
  outcome: z.enum(CLASSIFICATION_OUTCOMES).nullable(),
  manual: z.boolean().describe('The type was chosen by a person.'),
  doubtful: z.boolean().describe('The closest type, or none: a fallback or untyped outcome.'),
});

const reviewedValueSchema = z.object({
  section: z.enum(VALUE_SECTIONS),
  name: z.string(),
  confidence: confidenceSchema
    .nullable()
    .describe(
      'Of the extraction, the mean of the items for a list; null for a manual value or one ' +
        'with no record of how it was read.',
    ),
  page: z.int().nullable(),
  quote: z.string().nullable().describe('Untrusted content read from the document.'),
  manual: z.boolean().describe('Set or confirmed by a person.'),
  doubtful: z.boolean().describe('Not manual, and below the threshold or of no known confidence.'),
  confirmable: z.boolean().describe('Can be named in `confirm` of a correction.'),
});
export type ReviewedValue = z.output<typeof reviewedValueSchema>;

// What a person needs to review a document: why it is flagged, and how sure the pipeline
// is of its type and of each value. The rule is the server's, with its current threshold.
export const documentReviewSchema = z.object({
  threshold: confidenceSchema.describe(
    'The current `CONFIDENCE_THRESHOLD` of the server, which may differ from the one the ' +
      'document was settled with.',
  ),
  reasons: z
    .array(z.enum(REVIEW_REASONS))
    .describe('Why the document is flagged; empty unless it is `needs_review`.'),
  rejected_values: z
    .int()
    .min(0)
    .describe('Values the model returned that were dropped at the last extraction.'),
  type: reviewedTypeSchema,
  values: z.array(reviewedValueSchema),
});
export type DocumentReview = z.output<typeof documentReviewSchema>;
