import {
  isoDateSchema,
  keyDateKindSchema,
  MAX_FACT_LENGTH,
  MAX_FACTS_PER_DOCUMENT,
  MAX_IDENTIFIER_VALUE_LENGTH,
  MAX_KEY_DATE_LABEL_LENGTH,
  MAX_KEY_DATES_PER_DOCUMENT,
  MAX_KNOWLEDGE_QUOTE_LENGTH,
  MAX_NOTICE_PERIOD,
  MAX_SUBJECT_NAME_LENGTH,
  MAX_SUBJECTS_PER_DOCUMENT,
  noticePeriodUnitSchema,
  subjectKindSchema,
} from '@liasse/contract/domain';
import { z } from 'zod';

// The knowledge section of one extraction call, as the pipeline hands it over once it has
// verified the quotes and resolved the entities. Every text in it was read in a document
// or written by a model about one: it is data, and is validated here before anything is
// done with it.

const confidenceSchema = z.number().min(0).max(1);

const traceShape = {
  model: z.string().min(1),
  // Null for a document without a type, which has the common core only.
  schemaVersion: z.int().min(1).nullable(),
  page: z.int().min(1),
  quote: z.string().min(1).max(MAX_KNOWLEDGE_QUOTE_LENGTH),
  confidence: confidenceSchema,
};

export const knowledgeKeyDateSchema = z.strictObject({
  kind: keyDateKindSchema,
  date: isoDateSchema,
  label: z.string().trim().min(1).max(MAX_KEY_DATE_LABEL_LENGTH),
  ...traceShape,
});
export type KnowledgeKeyDate = z.output<typeof knowledgeKeyDateSchema>;

export const knowledgeFactSchema = z
  .strictObject({
    text: z.string().trim().min(1).max(MAX_FACT_LENGTH),
    validFrom: isoDateSchema.nullable(),
    validTo: isoDateSchema.nullable(),
    // Resolved by the pipeline through `resolveEntity`.
    entityIds: z.array(z.string().min(1)),
    // Names of the subjects the fact is about, as the candidates of this document name them.
    subjects: z.array(z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH)),
    ...traceShape,
  })
  .refine(
    ({ validFrom, validTo }) => validFrom === null || validTo === null || validFrom <= validTo,
    {
      path: ['validTo'],
      message: 'expected the end of the validity on or after its start',
    },
  );
export type KnowledgeFact = z.output<typeof knowledgeFactSchema>;

export const knowledgeSubjectSchema = z.strictObject({
  kind: subjectKindSchema,
  name: z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH),
  // The one strong identifier of the subject, as the document writes it. What it is follows
  // from the kind: a plate or a vehicle identification number for a vehicle, an address for
  // a property, a contract or account number otherwise.
  identifier: z.string().trim().min(1).max(MAX_IDENTIFIER_VALUE_LENGTH).optional(),
});
export type KnowledgeSubject = z.output<typeof knowledgeSubjectSchema>;

// The notice period a contract states: "2 months" is `{ amount: 2, unit: 'months' }`. The
// notice deadline is computed from it, never taken from the model.
export const noticePeriodSchema = z
  .strictObject({
    amount: z.int().min(1),
    unit: noticePeriodUnitSchema,
    confidence: confidenceSchema,
  })
  .refine(({ amount, unit }) => amount <= MAX_NOTICE_PERIOD[unit], {
    path: ['amount'],
    message: 'expected a notice period of at most five years',
  });
export type NoticePeriod = z.output<typeof noticePeriodSchema>;

export const knowledgeSchema = z.strictObject({
  keyDates: z.array(knowledgeKeyDateSchema).max(MAX_KEY_DATES_PER_DOCUMENT),
  facts: z.array(knowledgeFactSchema).max(MAX_FACTS_PER_DOCUMENT),
  subjects: z.array(knowledgeSubjectSchema).max(MAX_SUBJECTS_PER_DOCUMENT),
  noticePeriod: noticePeriodSchema.optional(),
});

// A notice period is one value among the knowledge of a document: one the model got wrong
// is dropped alone and counted, as a rejected value of the extraction is.
const receivedSchema = knowledgeSchema.extend({ noticePeriod: z.unknown().optional() });

export interface Knowledge extends Omit<z.output<typeof knowledgeSchema>, 'noticePeriod'> {
  readonly noticePeriod?: NoticePeriod;
  // Values of the section that were dropped as not valid.
  readonly rejectedValues: number;
}

type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value;

// What a caller hands over: the same shape, which it need not be able to write to.
export type KnowledgeInput = DeepReadonly<z.input<typeof knowledgeSchema>>;

export interface KnowledgeDocument {
  readonly id: string;
  // A private document never reaches an embedding provider outside the installation.
  readonly private: boolean;
}

export class InvalidKnowledgeError extends Error {
  override readonly name: string = 'InvalidKnowledgeError';
}

export const parseKnowledge = (input: unknown): Knowledge => {
  const parsed = receivedSchema.safeParse(input);
  // Zod's issues name the paths and the rules, never the rejected values.
  if (!parsed.success) throw new InvalidKnowledgeError(z.prettifyError(parsed.error));
  const { noticePeriod: received, ...rest } = parsed.data;
  if (received === undefined) return { ...rest, rejectedValues: 0 };
  const noticePeriod = noticePeriodSchema.safeParse(received);
  return noticePeriod.success
    ? { ...rest, noticePeriod: noticePeriod.data, rejectedValues: 0 }
    : { ...rest, rejectedValues: 1 };
};
