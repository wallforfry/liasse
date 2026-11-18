import type {
  ChangeDecision,
  DocumentCorrection,
  DocumentPart,
  ListChangesOptions,
  ListSubjectsOptions,
  TypeSuggestion,
  UpcomingOptions,
} from '@liasse/contract';
import type { JsonObject } from '../db/columns.ts';
import type { DeletedDocument } from '../ingest/delete-document.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { type ApiContext } from './context.ts';
import { ApiError, documentNotFound, notImplemented } from './errors.ts';
import type { KnowledgeFeatures } from './knowledge.ts';

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
export interface ApiFeatures extends KnowledgeFeatures {
  /** `correctDocument` of the pipeline, given `{ id, ...correction }`. */
  readonly correctDocument?: (input: JsonObject) => Promise<CorrectionOutcome>;
  /** `suggestType` of the pipeline: a draft of a type from what a person wrote of it. */
  readonly suggestType?: (request: string) => Promise<TypeSuggestion>;
  readonly listSubjects?: (options: ListSubjectsOptions) => Promise<JsonObject>;
  readonly upcoming?: (options: UpcomingOptions) => Promise<JsonObject>;
  readonly listChanges?: (options: ListChangesOptions) => Promise<JsonObject>;
  readonly applyChange?: (id: string, decision: ChangeDecision) => Promise<JsonObject | undefined>;
  readonly requestConsolidationRun?: () => Promise<JsonObject>;
  readonly listConsolidationRuns?: () => Promise<JsonObject>;
  /**
   * Runs in the transaction of a deletion, for what must follow it outside Liasse: the
   * Hindsight sync queues its forget there, so it commits with the tombstone.
   */
  readonly onDocumentDeleted?: (tx: Transaction, document: DeletedDocument) => Promise<void>;
}

const NOT_FOUND_CODE = 'document_not_found';

/** The parts of a document a correction answers with, by REST and MCP alike. */
export const CORRECTED_PARTS: readonly DocumentPart[] = ['fields', 'provenance'];

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
  throw new ApiError('invalid_correction', 'The correction was refused.', {
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
    throw new ApiError('change_not_found', 'No change has this id.');
  }
  return result;
};

export const requestConsolidationRun = async ({
  features,
}: Pick<ApiContext, 'features'>): Promise<JsonObject> => {
  if (features.requestConsolidationRun === undefined) throw notImplemented('consolidation runs');
  return features.requestConsolidationRun();
};

export const listConsolidationRuns = async ({
  features,
}: Pick<ApiContext, 'features'>): Promise<JsonObject> => {
  if (features.listConsolidationRuns === undefined) throw notImplemented('consolidation runs');
  return features.listConsolidationRuns();
};
