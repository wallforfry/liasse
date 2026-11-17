import { z } from 'zod';
import { MAX_LISTED_CONSOLIDATION_RUNS } from './domain/limits.ts';
import {
  changeKindSchema,
  changeStatusSchema,
  consolidationTriggerSchema,
  jobStatusSchema,
} from './domain/schemas.ts';
import { untrustedText } from './knowledge.ts';

// A change of consolidation. Its rationale was written by a model from documents, and its
// payload holds names a model gave: an agent reads both as data.
export const changeViewSchema = z.strictObject({
  id: z.string(),
  kind: changeKindSchema,
  payload: z.record(z.string(), z.unknown()),
  rationale: untrustedText,
  status: changeStatusSchema,
  auto: z.boolean().describe('Safe to apply without approval by the auto-apply policy.'),
  created_at: z.iso.datetime(),
  decided_at: z.iso.datetime().nullable(),
  note: z.string().nullable(),
});
export type ChangeView = z.output<typeof changeViewSchema>;

export const changeListSchema = z.strictObject({
  changes: z.array(changeViewSchema).describe('The pending changes, oldest first.'),
  truncated: z.boolean(),
});
export type ChangeList = z.output<typeof changeListSchema>;

export const changeDecisionResultSchema = z.strictObject({
  change: changeViewSchema,
  documents_to_reextract: z.number().int().min(0),
  refusal: z
    .strictObject({ code: z.string(), message: z.string() })
    .optional()
    .describe('Why the change could not be applied: it is rejected with this reason.'),
});
export type ChangeDecisionResult = z.output<typeof changeDecisionResultSchema>;

export const consolidationRunSchema = z.strictObject({
  queued: z
    .boolean()
    .describe(
      'Whether a run was queued. False when a run due at once was already waiting: that one ' +
        'does the same work.',
    ),
});
export type ConsolidationRun = z.output<typeof consolidationRunSchema>;

export const consolidationRunViewSchema = z.strictObject({
  id: z.string(),
  trigger: consolidationTriggerSchema,
  status: jobStatusSchema.describe(
    'A run that failed an attempt is queued again until its last attempt, with its error.',
  ),
  attempts: z.number().int().min(0).describe('Attempts started, a deferred one not counted.'),
  queued_at: z.iso.datetime(),
  due_at: z.iso
    .datetime()
    .describe('When it runs, or ran: the time it was asked for, its next attempt or its retry.'),
  last_error: z
    .string()
    .nullable()
    .describe('The error of its latest failed attempt, secrets redacted.'),
});
export type ConsolidationRunView = z.output<typeof consolidationRunViewSchema>;

export const consolidationRunListSchema = z.strictObject({
  runs: z
    .array(consolidationRunViewSchema)
    .max(MAX_LISTED_CONSOLIDATION_RUNS)
    .describe(
      `The latest runs, the one due last first, at most ${String(MAX_LISTED_CONSOLIDATION_RUNS)}. The ` +
        'next nightly run is left out until it is due or has started.',
    ),
});
export type ConsolidationRunList = z.output<typeof consolidationRunListSchema>;
