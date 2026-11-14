import { z } from 'zod';
import { MAX_CHANGE_RATIONALE_LENGTH, MAX_FIELDS_PER_TYPE } from '../domain/limits.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { TextModel } from '../models/ports.ts';
import { UNTRUSTED_RULE } from '../pipeline/prompts/classification.ts';
import { wrapUntrusted } from '../prompt/untrusted.ts';
import type { RegisteredType } from '../registry/type-store.ts';
import type { TypeExample } from './type-examples.ts';

export const MERGE_DECISIONS = ['merge', 'common_parent', 'distinct'] as const;
export type MergeDecision = (typeof MERGE_DECISIONS)[number];

const SYSTEM = [
  'You keep a registry of document types from drifting: two types may describe the same kind of document.',
  UNTRUSTED_RULE,
  'You are shown two types, each with its description, its fields and up to three example documents.',
  'Answer "merge" when every document of one type would be filed as well under the other: "target" is the slug of the type to keep, and "field_mapping" maps each field of the other type to the field of the target that holds the same information, or to null when the target has none.',
  'Answer "common_parent" when the two are distinct kinds of one family, and "distinct" otherwise; "target" and "field_mapping" are then ignored.',
  'Prefer "distinct" whenever in doubt: a wrong merge files documents under the wrong type.',
  'Give your confidence between 0 and 1, and one or two sentences of rationale.',
].join('\n');

export interface MergeSide {
  readonly type: RegisteredType;
  readonly examples: readonly TypeExample[];
}

const describeSide = ({ type, examples }: MergeSide) => ({
  slug: type.slug,
  description: type.description,
  status: type.status,
  fields: type.fields,
  examples: examples.map(({ title, fields, extra }) => ({ title, fields, extra })),
});

// Descriptions were written by a model that read documents, and the examples are values
// of documents: all of it is delimited, masked once more before it leaves.
const describe = (left: MergeSide, right: MergeSide): string =>
  wrapUntrusted(
    redactSensitiveIdentifiers(
      JSON.stringify({ types: [describeSide(left), describeSide(right)] }, null, 2),
    ),
  );

const answerSchema = (slugs: readonly [string, string]) =>
  z.strictObject({
    decision: z.enum(MERGE_DECISIONS),
    target: z.enum(slugs),
    field_mapping: z
      .array(
        z.strictObject({
          source_field: z.string().min(1),
          target_field: z.string().min(1).nullable(),
        }),
      )
      .max(MAX_FIELDS_PER_TYPE),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(MAX_CHANGE_RATIONALE_LENGTH),
  });

export interface MergeAnswer {
  readonly decision: MergeDecision;
  readonly target: string;
  readonly fieldMapping: readonly { readonly from: string; readonly to: string | null }[];
  readonly confidence: number;
  readonly rationale: string;
  readonly model: string;
}

/** The one call of a merge candidate: what the text model makes of the pair. */
export const askMerge = async (
  textModel: TextModel,
  left: MergeSide,
  right: MergeSide,
  signal?: AbortSignal,
): Promise<MergeAnswer> => {
  const { object, model } = await textModel.generateObject({
    schema: answerSchema([left.type.slug, right.type.slug]),
    system: SYSTEM,
    prompt: describe(left, right),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    decision: object.decision,
    target: object.target,
    fieldMapping: object.field_mapping.map(({ source_field: from, target_field: to }) => ({
      from,
      to,
    })),
    confidence: object.confidence,
    rationale: object.rationale,
    model,
  };
};
