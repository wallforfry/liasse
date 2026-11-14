import type { TypeProvenance } from '../../domain/provenance.ts';
import { createType } from '../../registry/create-type.ts';
import type { RegistryError } from '../../registry/errors.ts';
import { resolveType } from '../../registry/read-types.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import type { PipelineDeps } from '../deps.ts';
import { classificationPrompt, classificationSystemPrompt } from '../prompts/classification.ts';
import type { Candidate } from './candidates.ts';
import {
  type Classification,
  classificationSchema,
  type NewTypeDecision,
} from './classification-schema.ts';

export interface TypeDecision {
  /** Null for a document left without a type. */
  readonly typeId: string | null;
  readonly provenance: TypeProvenance;
}

export interface TypeQuestion {
  readonly opening: string;
  readonly candidates: readonly Candidate[];
  readonly hint: string | null;
}

interface Answer {
  readonly decision: Classification;
  readonly model: string;
}

interface Assigned {
  readonly type: RegisteredType;
  readonly outcome: 'existing' | 'new';
}

type Settled = Assigned | { readonly refused: RegistryError };

const ask = async (
  { textModel, settings }: PipelineDeps,
  { opening, candidates, hint }: TypeQuestion,
  signal: AbortSignal,
  refusal?: { readonly proposal: unknown; readonly reason: string },
): Promise<Answer> => {
  const { object, model } = await textModel.generateObject({
    schema: classificationSchema(candidates.map(({ type }) => type.slug)),
    system: classificationSystemPrompt(settings.schemaLanguage),
    prompt: classificationPrompt({
      opening,
      hint,
      candidates: candidates.map(({ type, exampleTitle }) => ({
        slug: type.slug,
        description: type.description,
        exampleTitle,
      })),
      ...(refusal === undefined ? {} : { refusal }),
    }),
    signal,
  });
  return { decision: object, model };
};

// A slug the registry already holds, under that name or as an alias, is the type the
// model was after: it was not among the candidates, and is used as it is.
const create = async (
  { db, embedder, settings, now }: PipelineDeps,
  { new_type: proposal }: NewTypeDecision,
): Promise<Settled> => {
  const created = await createType(
    {
      slug: proposal.slug,
      description: proposal.description,
      parentSlug: proposal.parent_slug,
      fields: proposal.fields,
    },
    {
      db,
      embedder,
      maxNewTypesPerDay: settings.maxNewTypesPerDay,
      schemaLanguage: settings.schemaLanguage,
      ...(now === undefined ? {} : { now }),
    },
  );
  if (created.ok) return { type: created.value, outcome: 'new' };
  const holder =
    created.error.code === 'name_taken'
      ? await resolveType(created.error.heldBy, { db })
      : undefined;
  return holder === undefined ? { refused: created.error } : { type: holder, outcome: 'existing' };
};

const settle = async (
  deps: PipelineDeps,
  candidates: readonly Candidate[],
  decision: Classification,
): Promise<Settled> => {
  if (decision.decision === 'new') return create(deps, decision);
  const chosen = candidates.find(({ type }) => type.slug === decision.slug);
  if (chosen === undefined) throw new Error('The model chose a type that was not offered');
  return { type: chosen.type, outcome: 'existing' };
};

const assignment = ({ type, outcome }: Assigned, { decision, model }: Answer): TypeDecision => ({
  typeId: type.id,
  provenance: { model, confidence: decision.confidence, outcome },
});

// Spec: past the daily quota, and for a proposal still refused after one correction,
// the document gets the closest candidate and is flagged for review; with no candidate
// it stays without a type. Nothing vouches for such an assignment: its confidence is 0.
const fallback = (candidates: readonly Candidate[], model: string): TypeDecision => {
  const [closest] = candidates;
  return closest === undefined
    ? { typeId: null, provenance: { model, confidence: 0, outcome: 'untyped' } }
    : { typeId: closest.type.id, provenance: { model, confidence: 0, outcome: 'fallback' } };
};

/**
 * One classification call, and a second one only when the registry refused the proposed
 * type for a reason the model can correct: the reason is given back to it once.
 */
export const decideType = async (
  deps: PipelineDeps,
  question: TypeQuestion,
  signal: AbortSignal,
): Promise<TypeDecision> => {
  const first = await ask(deps, question, signal);
  const settled = await settle(deps, question.candidates, first.decision);
  if ('type' in settled) return assignment(settled, first);
  if (settled.refused.code === 'quota_exceeded') return fallback(question.candidates, first.model);
  const second = await ask(deps, question, signal, {
    proposal: first.decision,
    reason: settled.refused.message,
  });
  const corrected = await settle(deps, question.candidates, second.decision);
  return 'type' in corrected
    ? assignment(corrected, second)
    : fallback(question.candidates, second.model);
};
