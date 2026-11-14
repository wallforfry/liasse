import { z } from 'zod';
import type { SchemaLanguage } from '../domain/enums.ts';
import {
  MAX_CHANGE_RATIONALE_LENGTH,
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_PROMOTION_KEYS,
} from '../domain/limits.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { TextModel } from '../models/ports.ts';
import { namingConventions, UNTRUSTED_RULE } from '../pipeline/prompts/classification.ts';
import { wrapUntrusted } from '../prompt/untrusted.ts';
import { FIELD_PRIMITIVES } from '../registry/primitives.ts';
import type { RegisteredType } from '../registry/type-store.ts';

const systemPrompt = (language: SchemaLanguage): string =>
  [
    'You keep a registry of document types: you turn information that documents of one type keep outside its schema into fields of that type.',
    UNTRUSTED_RULE,
    'You are shown a type, its fields, the keys of "extra" that most of its documents carry (the candidates) with sample values, and the other keys of "extra" with their counts.',
    'For each candidate worth a field, give its canonical name, its definition and, as variants, the other keys that hold the same information under another name (customer_no and customer_number, for instance). Leave out a candidate that is not worth a field.',
    'Reuse the name and the definition of an existing field of the type when the candidate holds the same information.',
    namingConventions(language),
    `A definition is {"type": one of ${FIELD_PRIMITIVES.join(', ')}}; an enum adds "values" (a list of strings), an identifier may add "format", a list adds "items" (the definition of one item, never a list).`,
    'Give one sentence of rationale for each field.',
  ].join('\n');

export interface PromotionCandidate {
  readonly key: string;
  readonly documents: number;
  readonly samples: readonly unknown[];
}

export interface PromotionRequest {
  readonly type: RegisteredType;
  readonly documents: number;
  readonly candidates: readonly PromotionCandidate[];
  /** Every key of `extra` with the documents that carry it, the most frequent first. */
  readonly keys: readonly (readonly [string, number])[];
}

// Keys and values come from documents through a model: delimited, and masked once more.
const describe = ({ type, documents, candidates, keys }: PromotionRequest): string =>
  wrapUntrusted(
    redactSensitiveIdentifiers(
      JSON.stringify(
        {
          type: { slug: type.slug, description: type.description, fields: type.fields },
          documents,
          candidates,
          other_keys: Object.fromEntries(keys.slice(0, MAX_FIELD_PROMOTION_KEYS)),
        },
        null,
        2,
      ),
    ),
  );

const answerSchema = (candidates: readonly [string, ...string[]]) =>
  z.strictObject({
    promotions: z
      .array(
        z.strictObject({
          key: z.enum(candidates),
          name: z.string().min(1).max(MAX_FIELD_NAME_LENGTH),
          // Read loosely: the registry validates the definition and the name.
          definition: z.looseObject({ type: z.string() }),
          variants: z.array(z.string().min(1)).max(MAX_FIELD_PROMOTION_KEYS),
          rationale: z.string().trim().min(1).max(MAX_CHANGE_RATIONALE_LENGTH),
        }),
      )
      .max(candidates.length),
  });

export type ProposedPromotion = z.output<ReturnType<typeof answerSchema>>['promotions'][number];

export interface PromotionAnswer {
  readonly promotions: readonly ProposedPromotion[];
  readonly model: string;
}

/** The one call of field promotion for a type with at least one candidate. */
export const askPromotions = async (
  textModel: TextModel,
  language: SchemaLanguage,
  request: PromotionRequest,
  signal?: AbortSignal,
): Promise<PromotionAnswer> => {
  const [first, ...rest] = request.candidates.map(({ key }) => key);
  if (first === undefined) return { promotions: [], model: '' };
  const { object, model } = await textModel.generateObject({
    schema: answerSchema([first, ...rest]),
    system: systemPrompt(language),
    prompt: describe(request),
    ...(signal === undefined ? {} : { signal }),
  });
  return { promotions: object.promotions, model };
};
