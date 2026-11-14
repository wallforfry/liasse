import { z } from 'zod';
import { changeKindSchema, changeStatusSchema } from '../domain/schemas.ts';
import type { DecisionOutcome } from './apply-change.ts';
import type { StoredChange } from './change-store.ts';

// The rationale and the payload were written from documents by a model, or by
// consolidation from names a model gave: an agent reads them as data.
export const changeViewSchema = z.strictObject({
  id: z.string(),
  kind: changeKindSchema,
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string(),
  status: changeStatusSchema,
  auto: z.boolean().describe('Safe to apply without approval by the auto-apply policy.'),
  created_at: z.iso.datetime(),
  decided_at: z.iso.datetime().nullable(),
  note: z.string().nullable(),
});
export type ChangeView = z.output<typeof changeViewSchema>;

export const changeListSchema = z.strictObject({
  changes: z.array(changeViewSchema),
  truncated: z.boolean(),
});
export type ChangeList = z.output<typeof changeListSchema>;

export const changeDecisionResultSchema = z.strictObject({
  change: changeViewSchema,
  documents_to_reextract: z.number().int().min(0),
  refusal: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});
export type ChangeDecisionResult = z.output<typeof changeDecisionResultSchema>;

export const viewChange = (change: StoredChange): ChangeView => ({
  id: change.id,
  kind: change.kind,
  payload: change.payload,
  rationale: change.rationale,
  status: change.status,
  auto: change.auto,
  created_at: change.createdAt.toISOString(),
  decided_at: change.decidedAt?.toISOString() ?? null,
  note: change.note,
});

export const viewDecision = ({
  change,
  reextractions,
  refusal,
}: DecisionOutcome): ChangeDecisionResult => ({
  change: viewChange(change),
  documents_to_reextract: reextractions,
  ...(refusal === undefined ? {} : { refusal }),
});
