import { z } from 'zod';
import { ENTITY_IDENTIFIER_TYPES } from '../../domain/enums.ts';
import {
  MAX_ENTITY_CONTEXT_LENGTH,
  MAX_ENTITY_NAME_LENGTH,
  MAX_FACT_LENGTH,
  MAX_IDENTIFIER_VALUE_LENGTH,
  MAX_IDENTIFIERS_PER_MENTION,
  MAX_SUBJECT_NAME_LENGTH,
} from '../../domain/limits.ts';
import { entityKindSchema, subjectKindSchema } from '../../domain/schemas.ts';
import { isoDateSchema } from '../../domain/values.ts';
import { CORE_FIELD_NAMES } from '../../registry/core-fields.ts';
import type { TypeFields } from '../../registry/fields.ts';
import { isPlainRecord } from '../../registry/own.ts';
import { untypedValueSchema, type ValueWrapper } from '../../registry/primitives.ts';
import { coreValueSchema, valueSchemaForFields } from '../../registry/values.ts';

export const MAX_QUOTE_LENGTH = 300;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 600;

/** What an element the model got wrong parses to, instead of failing the whole output. */
export const REJECTED: unique symbol = Symbol('rejected');
export type Rejected = typeof REJECTED;

// One bad value must not cost the document its other values. The JSON Schema sent to the
// provider is the one of `schema`; the symbol is the `default` Zod derives from a catch
// value, and JSON has no symbol, so nothing of it reaches the provider.
const lenient = (schema: z.ZodType): z.ZodType => schema.pipe(z.unknown()).catch(REJECTED);

const evidence = {
  page: z.number().int().min(1),
  quote: z.string().min(1).max(MAX_QUOTE_LENGTH),
  confidence: z.number().min(0).max(1),
};

export const evidencedSchema = z.object({ value: z.unknown(), ...evidence });
export type Evidenced = z.output<typeof evidencedSchema>;

export const evidenced: ValueWrapper = (value) => lenient(z.object({ value, ...evidence }));

export const mentionIdentifierTypes = ENTITY_IDENTIFIER_TYPES.filter((type) => type !== 'other');

export const entityDetailSchema = z.object({
  name: z.string().trim().min(1).max(MAX_ENTITY_NAME_LENGTH),
  kind: entityKindSchema.optional(),
  identifiers: z
    .array(
      z.object({
        type: z.enum(mentionIdentifierTypes),
        value: z.string().min(1).max(MAX_IDENTIFIER_VALUE_LENGTH),
      }),
    )
    .max(MAX_IDENTIFIERS_PER_MENTION)
    .optional(),
  context: z.string().trim().max(MAX_ENTITY_CONTEXT_LENGTH).optional(),
});
export type EntityDetail = z.output<typeof entityDetailSchema>;

export const factSchema = z.object({
  text: z.string().trim().min(1).max(MAX_FACT_LENGTH),
  valid_from: isoDateSchema.optional(),
  valid_to: isoDateSchema.optional(),
  entities: z.array(z.string().trim().min(1).max(MAX_ENTITY_NAME_LENGTH)).optional(),
  subjects: z.array(z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH)).optional(),
  ...evidence,
});
export type ExtractedFact = z.output<typeof factSchema>;

export const subjectCandidateSchema = z.object({
  kind: subjectKindSchema,
  name: z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH),
  identifier: z.string().trim().min(1).max(MAX_IDENTIFIER_VALUE_LENGTH).optional(),
});
export type SubjectCandidate = z.output<typeof subjectCandidateSchema>;

type RawRecord = Readonly<Record<string, unknown>>;

const recordOf = (input: unknown): RawRecord => (isPlainRecord(input) ? input : {});

// A model writes `null`, or a value of `null`, for what it did not find.
const isAbsent = (value: unknown): boolean =>
  value === null || value === undefined || (isPlainRecord(value) && value.value === null);

const present = (record: RawRecord): RawRecord =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => !isAbsent(value)));

const split = (
  record: RawRecord,
  known: ReadonlySet<string>,
): readonly [known: RawRecord, unknown: RawRecord] => {
  const entries = Object.entries(present(record));
  return [
    Object.fromEntries(entries.filter(([name]) => known.has(name))),
    Object.fromEntries(entries.filter(([name]) => !known.has(name))),
  ];
};

// `core` and `fields` are closed objects: a key they do not know would refuse the whole
// output. It is moved to `extra` instead, where a value outside the schema belongs, and
// never over a key the model wrote there itself.
const tidy =
  (fieldNames: readonly string[]) =>
  (input: unknown): unknown => {
    if (!isPlainRecord(input)) return input;
    const [core, strayCore] = split(recordOf(input.core), new Set(CORE_FIELD_NAMES));
    const [fields, strayFields] = split(recordOf(input.fields), new Set(fieldNames));
    return {
      ...present(input),
      core,
      fields,
      extra: { ...strayCore, ...strayFields, ...present(recordOf(input.extra)) },
    };
  };

const extraValueOf = lenient(z.object({ value: untypedValueSchema(), ...evidence }));

/**
 * What the extraction call must return for a document of a type with these fields. Each
 * value of `core`, `fields` and `extra` carries its page, its quote and a confidence;
 * an element that does not match parses to `REJECTED` and the rest is kept.
 */
export const extractionOutputSchema = (fields: TypeFields) =>
  z.preprocess(
    tidy(Object.keys(fields)),
    z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      core: coreValueSchema(evidenced),
      fields: valueSchemaForFields(fields, evidenced),
      extra: z.record(z.string(), extraValueOf),
      entities: z.array(lenient(entityDetailSchema)).optional(),
      facts: z.array(lenient(factSchema)).optional(),
      subjects: z.array(lenient(subjectCandidateSchema)).optional(),
    }),
  );
export type ExtractionOutput = z.output<ReturnType<typeof extractionOutputSchema>>;
