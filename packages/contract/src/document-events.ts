import { z } from 'zod';
import { CLASSIFICATION_OUTCOMES } from './domain/enums.ts';
import {
  liveDocumentStatusSchema,
  processingOutcomeSchema,
  processingStageSchema,
  textExtractionMethodSchema,
} from './domain/schemas.ts';

const count = z.int().min(0);

// Counts and labels only: an event never holds a value read from the document, a quote,
// an identifier or an error message.
export const documentEventDetailsSchema = z.strictObject({
  text_method: textExtractionMethodSchema.optional(),
  pages: count.optional(),
  attachments_ingested: count.optional(),
  attachments_skipped: count.optional(),
  classification: z.enum(CLASSIFICATION_OUTCOMES).optional(),
  rejected_values: count
    .optional()
    .describe('Values the model returned that failed validation and were dropped.'),
  truncated: z.boolean().optional().describe('The text was cut to fit one extraction call.'),
});
export type DocumentEventDetails = z.output<typeof documentEventDetailsSchema>;

export const documentEventSchema = z.object({
  id: z.string(),
  occurred_at: z.iso.datetime(),
  stage: processingStageSchema,
  outcome: processingOutcomeSchema,
  status: liveDocumentStatusSchema
    .nullable()
    .describe('The status of the document once the event was recorded.'),
  attempt: z.int().nullable().describe('The execution of the job, from 1, for a failure.'),
  max_attempts: z.int().nullable(),
  error_code: z.string().nullable().describe('A short code, never a message.'),
  error_name: z.string().nullable().describe('The class of the error, for `internal_error`.'),
  retryable: z
    .boolean()
    .nullable()
    .describe('Whether another attempt could succeed; false for a final refusal.'),
  model: z.string().nullable(),
  details: documentEventDetailsSchema,
});
export type DocumentEvent = z.output<typeof documentEventSchema>;

export const documentEventListSchema = z.object({
  events: z.array(documentEventSchema).describe('Oldest first; only the most recent are kept.'),
});
export type DocumentEventList = z.output<typeof documentEventListSchema>;
