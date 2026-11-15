import { z } from 'zod';
import { changeKindSchema, changeStatusSchema } from './domain/schemas.ts';
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
