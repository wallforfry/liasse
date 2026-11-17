import type { TypeRefusal } from '@liasse/contract/domain';
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

export type TypeDecision =
  | { readonly typeId: string; readonly provenance: TypeProvenance }
  /** No type: the new type the model proposed was not created, for `refusal`. */
  | {
      readonly typeId: null;
      readonly provenance: TypeProvenance;
      readonly refusal: TypeRefusal;
    };

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
  requireNew: boolean,
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
  // A person who asked for a new type only gets none of the existing ones, even named.
  const holder =
    created.error.code === 'name_taken' && !requireNew
      ? await resolveType(created.error.heldBy, { db })
      : undefined;
  return holder === undefined ? { refused: created.error } : { type: holder, outcome: 'existing' };
};

const chosenOf = async (
  deps: PipelineDeps,
  { candidates, reclassification }: TypeQuestion,
  decision: Classification,
): Promise<Settled> => {
  if (decision.decision === 'new') {
    return create(deps, decision, reclassification?.requireNew ?? false);
  }
  const chosen = candidates.find(({ type }) => type.slug === decision.slug);
  if (chosen === undefined) throw new Error('The model chose a type that was not offered');
  return { type: chosen.type, outcome: 'existing' };
};

// A new slug can name the rejected type, under its name or an alias: that is no answer.
const settle = async (
  deps: PipelineDeps,
  question: TypeQuestion,
  decision: Classification,
): Promise<Settled> => {
  const settled = await chosenOf(deps, question, decision);
  const rejected = question.reclassification?.rejected;
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

// Spec: a new type that could not be created leaves the document without a type, for
// review, with the reason. No existing type is assigned in its place: the model said none
// of the candidates fits, and the closest one by embedding is a type the document is not.
const untyped = (model: string, refusal: TypeRefusal): TypeDecision => ({
  typeId: null,
  provenance: { model, confidence: 0, outcome: 'untyped', refusal },
  refusal,
});

/** What the processing log records of a decision: codes only, never the proposal. */
export const classificationEvent = ({ provenance }: TypeDecision) =>
  'model' in provenance
    ? {
        model: provenance.model,
        details: {
          classification: provenance.outcome,
          ...(provenance.refusal === undefined ? {} : { type_refusal: provenance.refusal }),
        },
      }
    : {};

const refusalOf = ({ code }: Refusal): TypeRefusal => {
  if (code === 'quota_exceeded' || code === 'rejected_type') return code;
  return 'invalid_proposal';
};

/**
 * One classification call, and a second one only when the registry refused the proposed
 * type for a reason the model can correct: the reason is given back to it once. A new
 * type that may not be created, over quota or still refused, leaves the document without
 * a type and says why.
 */
export const decideType = async (
  deps: PipelineDeps,
  question: TypeQuestion,
  signal: AbortSignal,
): Promise<TypeDecision> => {
  const first = await ask(deps, question, signal);
  if (first.decision.decision === 'new' && !question.mayCreate) {
    return untyped(first.model, 'private_document');
  }
  const settled = await settle(deps, question, first.decision);
  if ('type' in settled) return assignment(settled, first);
  if (settled.refused.code === 'quota_exceeded') return untyped(first.model, 'quota_exceeded');
  const second = await ask(deps, question, signal, {
    proposal: first.decision,
    reason: settled.refused.message,
  });
  const corrected = await settle(deps, question, second.decision);
  return 'type' in corrected
    ? assignment(corrected, second)
    : untyped(second.model, refusalOf(corrected.refused));
};
