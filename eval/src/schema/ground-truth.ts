import {
  isoDateSchema,
  keyDateKindSchema,
  languageCodeSchema,
  linkKindSchema,
  moneySchema,
  periodSchema,
  supportedMimeSchema,
} from '@liasse/core/domain';
import {
  type CORE_FIELDS,
  fieldDefinitionSchema,
  type FieldPrimitive,
  fieldValueSchema,
} from '@liasse/core/registry';
import { PAGE_TEXT_METHODS } from '@liasse/core/text';
import { z } from 'zod';
import { expectationSchema, keySchema, requirementSchema } from './expectation.ts';

// The value the truth states for each field of the common core. The keys are checked
// against the core of the registry by the compiler, and the values are the schemas of the
// domain: an issuer or a recipient is the key of an entity of the corpus, which carries
// the names the system may give it.
export const CORE_TRUTH_VALUES = {
  document_date: isoDateSchema,
  issuer: keySchema,
  recipient: keySchema,
  amount: moneySchema,
  period: periodSchema,
  due_date: isoDateSchema,
  reference: z.string().min(1),
  language: languageCodeSchema,
} as const satisfies Readonly<Record<keyof typeof CORE_FIELDS, z.ZodType>>;

export type CoreFieldName = keyof typeof CORE_TRUTH_VALUES;

const coreTruthSchema = z.strictObject({
  document_date: expectationSchema(CORE_TRUTH_VALUES.document_date),
  issuer: expectationSchema(CORE_TRUTH_VALUES.issuer),
  recipient: expectationSchema(CORE_TRUTH_VALUES.recipient),
  amount: expectationSchema(CORE_TRUTH_VALUES.amount),
  period: expectationSchema(CORE_TRUTH_VALUES.period),
  due_date: expectationSchema(CORE_TRUTH_VALUES.due_date),
  reference: expectationSchema(CORE_TRUTH_VALUES.reference),
  language: expectationSchema(CORE_TRUTH_VALUES.language),
});

// The primitives of the registry a type field of the truth may have: those that need no
// parameter and hold one value. Each is compared by its own rule (see `score/compare.ts`).
export const TRUTH_PRIMITIVES = [
  'text',
  'number',
  'boolean',
  'date',
  'period',
  'money',
  'entity',
  'identifier',
] as const satisfies readonly FieldPrimitive[];
export type TruthPrimitive = (typeof TRUTH_PRIMITIVES)[number];

const valueSchemaOf = (primitive: TruthPrimitive): z.ZodType =>
  fieldValueSchema(fieldDefinitionSchema.parse({ type: primitive }));

// Types are emergent, and so are the names of their fields: the truth lists the names it
// accepts, the preferred one first, and the primitive that says how the value compares.
const typeFieldTruthSchema = z
  .strictObject({
    names: z.array(z.string().min(1)).min(1),
    primitive: z.enum(TRUTH_PRIMITIVES),
    expectation: expectationSchema(z.unknown()),
    // The value is sensitive: the truth gives the characters that may remain visible, and
    // the system must hold a value that ends with them without holding the clear one.
    masked: z.boolean(),
  })
  .superRefine(({ primitive, expectation, masked }, context) => {
    if (expectation.requirement === 'forbidden') return;
    const parsed = valueSchemaOf(masked ? 'identifier' : primitive).safeParse(expectation.value);
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        path: ['expectation', 'value'],
        message: `expected a ${primitive} value: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
      });
    }
  });

const typeTruthSchema = z.strictObject({
  // The slug a careful registry would give, generic and in English.
  category: z.string().min(1),
  // Other slugs that name the same kind of document without losing what matters.
  acceptable: z.array(z.string().min(1)),
  // The parent a registry may file the type under; a system that only finds the parent
  // is half right.
  parent: z.string().min(1).nullable(),
});

// A date may fairly be filed under several kinds (the day a termination takes effect is
// an end of validity and an effective date): the truth lists the kinds it accepts, the
// preferred one first. A forbidden entry means no date of any of these kinds exists.
const keyDateTruthSchema = z.strictObject({
  kinds: z.array(keyDateKindSchema).min(1),
  expectation: expectationSchema(isoDateSchema),
});

const linkTruthSchema = z.strictObject({
  kind: linkKindSchema,
  // The document this one supersedes, amends, terminates, pays, replies to or is attached to.
  target: keySchema,
  requirement: requirementSchema,
});

const subjectTruthSchema = z.strictObject({ subject: keySchema, requirement: requirementSchema });

// A fact is checked in substance, not in wording: a fact of the system matches when it
// carries every entity, subject, date and amount listed here.
const factTruthSchema = z.strictObject({
  statement: z.string().min(1),
  requirement: z.enum(['required', 'optional']),
  entities: z.array(keySchema),
  subjects: z.array(keySchema),
  dates: z.array(isoDateSchema),
  amounts: z.array(moneySchema),
});

export const SENSITIVE_IDENTIFIER_KINDS = [
  'iban',
  'card_number',
  'tax_number',
  'social_security_number',
] as const;
export type SensitiveIdentifierKind = (typeof SENSITIVE_IDENTIFIER_KINDS)[number];

// The document shows the identifier in clear. Outside the page text, the system may keep
// its last characters and nothing more.
const maskingTruthSchema = z.strictObject({
  kind: z.enum(SENSITIVE_IDENTIFIER_KINDS),
  clear: z.string().min(1),
  visible_tail: z.string().min(1),
});

const pageTruthSchema = z.strictObject({
  page: z.int().min(1),
  // `vision` for a page without a text layer, whose transcription is scored against `text`.
  method: z.enum(PAGE_TEXT_METHODS),
  text: z.string(),
});

export const HARD_CASES = [
  'duplicate_file',
  'near_duplicate',
  'prompt_injection',
  'mixed_pdf',
  'sensitive_identifiers',
  'private',
  'foreign_currency',
  'withdrawn_currency',
  'little_text',
  'email_attachment',
] as const;
export type HardCase = (typeof HARD_CASES)[number];

const sourceSchema = z.discriminatedUnion('kind', [
  // A file of the corpus, relative to its root.
  z.strictObject({ kind: z.literal('file'), path: z.string().min(1) }),
  // A file carried by an email of the corpus: it has no file of its own.
  z.strictObject({ kind: z.literal('attachment'), of: keySchema, filename: z.string().min(1) }),
]);

export const groundTruthSchema = z.strictObject({
  id: keySchema,
  // What the document is, for a person reading the set. Never scored.
  description: z.string().min(1),
  source: sourceSchema,
  mime: supportedMimeSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().min(1),
  // The document whose file has the same bytes: ingestion must answer with that one.
  duplicate_of: keySchema.nullable(),
  // The document that shows the same paper through another file.
  near_duplicate_of: keySchema.nullable(),
  hard_cases: z.array(z.enum(HARD_CASES)),
  type: typeTruthSchema,
  core: coreTruthSchema,
  fields: z.array(typeFieldTruthSchema),
  key_dates: z.array(keyDateTruthSchema),
  links: z.array(linkTruthSchema),
  subjects: z.array(subjectTruthSchema),
  facts: z.array(factTruthSchema).max(3),
  masking: z.array(maskingTruthSchema),
  // Whether the document must, may or must not be flagged private.
  private: requirementSchema,
  pages: z.array(pageTruthSchema).min(1),
});

export type GroundTruth = z.output<typeof groundTruthSchema>;
export type CoreTruth = GroundTruth['core'];
export type TypeTruth = GroundTruth['type'];
export type TypeFieldTruth = GroundTruth['fields'][number];
export type KeyDateTruth = GroundTruth['key_dates'][number];
export type LinkTruth = GroundTruth['links'][number];
export type SubjectTruth = GroundTruth['subjects'][number];
export type FactTruth = GroundTruth['facts'][number];
export type MaskingTruth = GroundTruth['masking'][number];
export type PageTruth = GroundTruth['pages'][number];
