import type { TypeProvenance } from '../../domain/provenance.ts';
import { createType } from '../../registry/create-type.ts';
import type { RegistryError } from '../../registry/errors.ts';
import { resolveType } from '../../registry/read-types.ts';
import type { RegisteredType } from '../../registry/type-store.ts';
import { maskOf } from '../bindings.ts';
import type { PipelineDeps } from '../deps.ts';
import { maskDeep } from '../extract/masking.ts';
import {
  classificationPrompt,
  classificationSystemPrompt,
  type ReclassificationLine,
} from '../prompts/classification.ts';
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
  /**
   * False for a private document when the embedder is outside the installation: the
   * description of a new type is embedded, and it was written from the document.
   */
  readonly mayCreate: boolean;
  /** Set when a person asked for the type again: the reclassification they asked for. */
  readonly reclassification?: Reclassification;
}

/** What a person said when asking for the type of a document to be decided again. */
export interface Reclassification {
  /** The type they said is wrong for the document, never chosen; absent for an untyped one. */
  readonly rejected: RegisteredType | undefined;
  readonly hint: string | null;
  /** Only a new type will do: the candidates are listed as parents and to avoid duplicates. */
  readonly requireNew: boolean;
}

interface Answer {
  readonly decision: Classification;
  readonly model: string;
}

interface Assigned {
  readonly type: RegisteredType;
  readonly outcome: 'existing' | 'new';
}

interface Refusal {
  readonly code: RegistryError['code'] | 'rejected_type';
  readonly message: string;
}

type Settled = Assigned | { readonly refused: Refusal };

const promptOf = ({ rejected, hint, requireNew }: Reclassification): ReclassificationLine => ({
  rejected:
    rejected === undefined ? null : { slug: rejected.slug, description: rejected.description },
  hint,
  requireNew,
});

const ask = async (
  { textModel, settings }: PipelineDeps,
  { opening, candidates, hint, reclassification }: TypeQuestion,
  signal: AbortSignal,
  refusal?: { readonly proposal: unknown; readonly reason: string },
): Promise<Answer> => {
  const requireNew = reclassification?.requireNew ?? false;
  const { object, model } = await textModel.generateObject({
    schema: classificationSchema(requireNew ? [] : candidates.map(({ type }) => type.slug)),
    system: classificationSystemPrompt(settings.schemaLanguage),
    prompt: classificationPrompt({
      opening,
      hint,
      candidates: candidates.map(({ type, exampleTitle }) => ({
        slug: type.slug,
        description: type.description,
        exampleTitle,
      })),
      ...(reclassification === undefined ? {} : { reclassification: promptOf(reclassification) }),
      ...(refusal === undefined ? {} : { refusal }),
    }),
    signal,
  });
  return { decision: object, model };
};

// A slug the registry already holds, under that name or as an alias, is the type the
// model was after: it was not among the candidates, and is used as it is.
//
// The description and the definitions are text the model wrote after reading the
// document; they reach `describe_types` and every later prompt, so a sensitive
// identifier in them is masked before the registry sees them. The registry bounds their
// lengths. Field names and slugs are snake_case: no identifier the detector knows fits.
const create = async (
  deps: PipelineDeps,
  { new_type: proposal }: NewTypeDecision,
): Promise<Settled> => {
  const { db, embedder, settings, now } = deps;
  const mask = maskOf(deps);
  const created = await createType(
    {
      slug: proposal.slug,
      description: mask(proposal.description),
      parentSlug: proposal.parent_slug,
      fields: maskDeep(mask)(proposal.fields),
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

const chosenOf = async (
  deps: PipelineDeps,
  candidates: readonly Candidate[],
  decision: Classification,
): Promise<Settled> => {
  if (decision.decision === 'new') return create(deps, decision);
  const chosen = candidates.find(({ type }) => type.slug === decision.slug);
  if (chosen === undefined) throw new Error('The model chose a type that was not offered');
  return { type: chosen.type, outcome: 'existing' };
};

// A new slug can name the rejected type, under its name or an alias: that is no answer.
const settle = async (
  deps: PipelineDeps,
  { candidates, reclassification }: TypeQuestion,
  decision: Classification,
): Promise<Settled> => {
  const settled = await chosenOf(deps, candidates, decision);
  const rejected = reclassification?.rejected;
  return 'type' in settled && settled.type.id === rejected?.id
    ? {
        refused: {
          code: 'rejected_type',
          message: `The slug names the type "${rejected.slug}", which a person said is wrong for this document.`,
        },
      }
    : settled;
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
 * type for a reason the model can correct: the reason is given back to it once. A new
 * type that may not be created is answered like a full quota.
 */
export const decideType = async (
  deps: PipelineDeps,
  question: TypeQuestion,
  signal: AbortSignal,
): Promise<TypeDecision> => {
  const first = await ask(deps, question, signal);
  if (first.decision.decision === 'new' && !question.mayCreate) {
    return fallback(question.candidates, first.model);
  }
  const settled = await settle(deps, question, first.decision);
  if ('type' in settled) return assignment(settled, first);
  if (settled.refused.code === 'quota_exceeded') return fallback(question.candidates, first.model);
  const second = await ask(deps, question, signal, {
    proposal: first.decision,
    reason: settled.refused.message,
  });
  const corrected = await settle(deps, question, second.decision);
  return 'type' in corrected
    ? assignment(corrected, second)
    : fallback(question.candidates, second.model);
};
