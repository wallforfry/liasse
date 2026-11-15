import {
  isoDateSchema,
  keyDateSchema,
  linkKindSchema,
  PAGE_TEXT_METHODS,
  subjectKindSchema,
} from '@liasse/contract/domain';
import { z } from 'zod';
import { keySchema } from './expectation.ts';
import { CORE_TRUTH_VALUES } from './ground-truth.ts';

const name = z.string().min(1);

// The common core as the system stores it: the values of the domain, an issuer and a
// recipient by the name that was extracted.
const systemCoreSchema = z.strictObject({
  document_date: CORE_TRUTH_VALUES.document_date.optional(),
  issuer: name.optional(),
  recipient: name.optional(),
  amount: CORE_TRUTH_VALUES.amount.optional(),
  period: CORE_TRUTH_VALUES.period.optional(),
  due_date: CORE_TRUTH_VALUES.due_date.optional(),
  reference: CORE_TRUTH_VALUES.reference.optional(),
  language: CORE_TRUTH_VALUES.language.optional(),
});

const systemFactSchema = z.strictObject({
  text: z.string(),
  valid_from: isoDateSchema.nullable(),
  valid_to: isoDateSchema.nullable(),
  // Names of the entities and labels of the subjects the system attached to the fact.
  entities: z.array(z.string()),
  subjects: z.array(z.string()),
});

// What the system derived from one document of the corpus, in the terms of the corpus:
// the harness that runs the pipeline translates its own document ids into corpus ids
// before scoring. Everything is what was stored, not what was shown to a model.
export const systemDocumentSchema = z.strictObject({
  // The corpus id of the document.
  id: keySchema,
  // The document the file was recognised as a copy of, when ingestion deduplicated it.
  duplicate_of: keySchema.nullable(),
  type: z.strictObject({ slug: name, parent_slug: name.nullable() }).nullable(),
  core: systemCoreSchema,
  key_dates: z.array(keyDateSchema),
  // Type fields and `extra` values, by name. Their primitives are not known here: the
  // truth says how each expected value compares.
  fields: z.record(name, z.unknown()),
  extra: z.record(name, z.unknown()),
  // The stored provenance, searched for identifiers that should have been masked.
  provenance: z.unknown(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  links: z.array(z.strictObject({ kind: linkKindSchema, target: keySchema })),
  subjects: z.array(z.strictObject({ kind: subjectKindSchema, label: name })),
  facts: z.array(systemFactSchema),
  private: z.boolean(),
  pages: z.array(
    z.strictObject({ page: z.int().min(1), method: z.enum(PAGE_TEXT_METHODS), text: z.string() }),
  ),
});

export type SystemDocument = z.output<typeof systemDocumentSchema>;
export type SystemFact = SystemDocument['facts'][number];
