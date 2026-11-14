import type {
  GetSubjectInput,
  GetSubjectOptions,
  RecallInput,
  RecallOptions,
  TimelineInput,
  TimelineOptions,
} from '../contract/knowledge-reads.ts';
import type { JsonObject } from '../db/columns.ts';
import type { ApiContext } from './context.ts';
import { notImplemented } from './errors.ts';

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
