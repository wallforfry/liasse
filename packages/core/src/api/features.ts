import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { changeKindSchema, keyDateKindSchema, subjectKindSchema } from '../domain/schemas.ts';
import { type ApiContext } from './context.ts';
import { ApiError, documentNotFound, notImplemented } from './errors.ts';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const isoDate = z.iso.date();

// What a caller may correct, by the `update_document` tool of the specification. The
// pipeline validates the values against the registry: this only bounds the envelope.
export const documentCorrectionSchema = z.strictObject({
  type: z.string().min(1).optional(),
  core: jsonObjectSchema.optional(),
  fields: jsonObjectSchema.optional(),
  private: z.boolean().optional(),
});
export type DocumentCorrection = z.output<typeof documentCorrectionSchema>;

export const listSubjectsOptionsSchema = z.strictObject({
  query: z.string().trim().min(1).optional(),
  kind: subjectKindSchema.optional(),
});
export type ListSubjectsOptions = z.output<typeof listSubjectsOptionsSchema>;

export const upcomingOptionsSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  kinds: z.array(keyDateKindSchema).min(1).optional(),
  types: z.array(z.string().min(1)).min(1).optional(),
  subject: z.string().min(1).optional(),
  current_only: z.boolean().default(true),
});
export type UpcomingOptions = z.output<typeof upcomingOptionsSchema>;

export const listChangesOptionsSchema = z.strictObject({
  kind: changeKindSchema.optional(),
});
export type ListChangesOptions = z.output<typeof listChangesOptionsSchema>;

export const CHANGE_DECISIONS = ['apply', 'reject'] as const;
export const changeDecisionSchema = z.strictObject({
  decision: z.enum(CHANGE_DECISIONS),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type ChangeDecision = z.output<typeof changeDecisionSchema>;

interface CorrectionProblem {
  readonly code: string;
  readonly message: string;
}

export type CorrectionOutcome =
  { readonly ok: true } | { readonly ok: false; readonly errors: readonly CorrectionProblem[] };

/**
 * The use cases whose module is not part of this build yet. Each is the narrow shape of
 * the function bound to it by the composition root; one left undefined answers
 * `not_implemented`. A feature returns `undefined` for an id it does not know.
 */
export interface ApiFeatures {
  /** `correctDocument` of the pipeline, given `{ id, ...correction }`. */
  readonly correctDocument?: (input: JsonObject) => Promise<CorrectionOutcome>;
  readonly listSubjects?: (options: ListSubjectsOptions) => Promise<JsonObject>;
  readonly upcoming?: (options: UpcomingOptions) => Promise<JsonObject>;
  readonly listChanges?: (options: ListChangesOptions) => Promise<JsonObject>;
  readonly applyChange?: (id: string, decision: ChangeDecision) => Promise<JsonObject | undefined>;
}

const NOT_FOUND_CODE = 'document_not_found';

/** Corrects a document. The caller reads it again to answer with its new state. */
export const correctDocument = async (
  { features }: Pick<ApiContext, 'features'>,
  id: string,
  correction: DocumentCorrection,
): Promise<void> => {
  if (features.correctDocument === undefined) throw notImplemented('document correction');
  const outcome = await features.correctDocument({ id, ...correction });
  if (outcome.ok) return;
  if (outcome.errors.some(({ code }) => code === NOT_FOUND_CODE)) throw documentNotFound();
  throw new ApiError('invalid', 'invalid_correction', 'The correction was refused.', {
    errors: outcome.errors.map(({ code, message }) => ({ code, message })),
  });
};

export const listSubjects = async (
  { features }: Pick<ApiContext, 'features'>,
  options: ListSubjectsOptions,
): Promise<JsonObject> => {
  if (features.listSubjects === undefined) throw notImplemented('subjects');
  return features.listSubjects(options);
};

export const upcoming = async (
  { features }: Pick<ApiContext, 'features'>,
  options: UpcomingOptions,
): Promise<JsonObject> => {
  if (features.upcoming === undefined) throw notImplemented('upcoming key dates');
  return features.upcoming(options);
};

export const listChanges = async (
  { features }: Pick<ApiContext, 'features'>,
  options: ListChangesOptions,
): Promise<JsonObject> => {
  if (features.listChanges === undefined) throw notImplemented('consolidation changes');
  return features.listChanges(options);
};

export const applyChange = async (
  { features }: Pick<ApiContext, 'features'>,
  id: string,
  decision: ChangeDecision,
): Promise<JsonObject> => {
  if (features.applyChange === undefined) throw notImplemented('consolidation changes');
  const result = await features.applyChange(id, decision);
  if (result === undefined) {
    throw new ApiError('not_found', 'change_not_found', 'No change has this id.');
  }
  return result;
};
