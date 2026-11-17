import { z } from 'zod';
import { documentEventSchema } from './document-events.ts';
import { JOB_WAITS, UNFINISHED_JOB_STATUSES } from './domain/enums.ts';
import { documentStateSchema, liveDocumentStatusSchema } from './domain/schemas.ts';

// A status is polled until processing ends: the whole log is `GET /documents/:id/events`.
export const DOCUMENT_STATUS_EVENTS = 10;

export const documentJobSchema = z.object({
  kind: z
    .string()
    .describe(
      'The job: `process_document`, `reextract_document`, `reclassify_document` or `reindex_document`.',
    ),
  state: z.enum(UNFINISHED_JOB_STATUSES),
  attempts: z.int().min(0).describe('Attempts started so far, a running one included.'),
  max_attempts: z.int().min(1),
  queued_at: z.iso.datetime(),
  run_after: z.iso.datetime().describe('When the job is due, for a queued one.'),
  waiting_for: z
    .enum(JOB_WAITS)
    .nullable()
    .describe(
      'Null while it runs. `worker`: it is due and waits for a free worker; `delay`: it waits until `run_after`.',
    ),
  jobs_ahead: z
    .int()
    .min(0)
    .nullable()
    .describe('For a job waiting for a worker: the due jobs of any kind claimed before it.'),
});
export type DocumentJob = z.output<typeof documentJobSchema>;

export const documentStatusSchema = z.object({
  id: z.string(),
  status: liveDocumentStatusSchema,
  state: documentStateSchema,
  error: z.string().nullable(),
  events: z
    .array(documentEventSchema)
    .describe(
      `The last ${String(DOCUMENT_STATUS_EVENTS)} events of its processing log, oldest first.`,
    ),
  analysis_pending: z
    .boolean()
    .describe(
      'A job that rewrites the type or the values of the document is queued or running, as in `GET /documents/:id`.',
    ),
  updated_at: z.iso.datetime().describe('The last change of the document, a correction included.'),
  job: documentJobSchema
    .nullable()
    .describe(
      'The processing job of the document that is queued or running, the running one first.',
    ),
});
export type DocumentStatusView = z.output<typeof documentStatusSchema>;
