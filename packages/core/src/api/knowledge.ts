import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import { type GetSubjectInput, getSubjectInputSchema } from '../knowledge/get-subject.ts';
import { type RecallInput, recallInputSchema } from '../knowledge/recall.ts';
import { type TimelineInput, timelineInputSchema } from '../knowledge/timeline.ts';
import type { ApiContext } from './context.ts';
import { notImplemented } from './errors.ts';

const PRIVATE_DESCRIPTION = 'Private documents are left out unless this is true.';

// The inputs of the knowledge reads as they travel: the field schemas are those of the
// knowledge layer, under snake_case names. The rules that tie two fields together (a
// subject or an entity, a window in order) stay with the knowledge layer, which parses
// what it is given.
const { includePrivate: timelinePrivate, ...timelineFields } = timelineInputSchema.shape;
export const timelineOptionsSchema = z.strictObject({
  ...timelineFields,
  include_private: timelinePrivate.describe(PRIVATE_DESCRIPTION),
});
export type TimelineOptions = z.output<typeof timelineOptionsSchema>;

const { includePrivate: recallPrivate, ...recallFields } = recallInputSchema.shape;
export const recallOptionsSchema = z.strictObject({
  ...recallFields,
  include_private: recallPrivate.describe(PRIVATE_DESCRIPTION),
});
export type RecallOptions = z.output<typeof recallOptionsSchema>;

const { includePrivate: subjectPrivate, asOf, ...subjectFields } = getSubjectInputSchema.shape;
export const getSubjectOptionsSchema = z.strictObject({
  ...subjectFields,
  as_of: asOf,
  include_private: subjectPrivate.describe(PRIVATE_DESCRIPTION),
});
export type GetSubjectOptions = z.output<typeof getSubjectOptionsSchema>;

/** The knowledge reads, bound by the composition root; see `ApiFeatures`. */
export interface KnowledgeFeatures {
  readonly timeline?: (input: TimelineInput) => Promise<JsonObject>;
  readonly recall?: (input: RecallInput) => Promise<JsonObject>;
  readonly getSubject?: (input: GetSubjectInput) => Promise<JsonObject>;
}

type Features = Pick<ApiContext, 'features'>;

/** Dated facts and documents of a subject or an entity. Fact texts are untrusted content. */
export const timeline = async (
  { features }: Features,
  { include_private, ...options }: TimelineOptions,
): Promise<JsonObject> => {
  if (features.timeline === undefined) throw notImplemented('timelines');
  return features.timeline({ ...options, includePrivate: include_private });
};

/** Facts found by a query, memory-style. Fact texts are untrusted content. */
export const recall = async (
  { features }: Features,
  { include_private, ...options }: RecallOptions,
): Promise<JsonObject> => {
  if (features.recall === undefined) throw notImplemented('fact recall');
  return features.recall({ ...options, includePrivate: include_private });
};

/** A subject by its id or by words that name it. Names are untrusted content. */
export const getSubject = async (
  { features }: Features,
  { include_private, as_of, ...options }: GetSubjectOptions,
): Promise<JsonObject> => {
  if (features.getSubject === undefined) throw notImplemented('subjects');
  return features.getSubject({
    ...options,
    ...(as_of === undefined ? {} : { asOf: as_of }),
    includePrivate: include_private,
  });
};
