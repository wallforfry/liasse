import {
  entityIdentifierTypeSchema,
  entityKindSchema,
  isoDateSchema,
  subjectKindSchema,
} from '@liasse/core/domain';
import { z } from 'zod';
import { keySchema } from './expectation.ts';
import { groundTruthSchema } from './ground-truth.ts';

// An organisation or a person the household deals with. The system may name it by its
// canonical name or by any alias; names are compared without case, accents or legal form.
const entityTruthSchema = z.strictObject({
  key: keySchema,
  kind: entityKindSchema,
  canonical_name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  identifiers: z.array(
    z.strictObject({ type: entityIdentifierTypeSchema, value: z.string().min(1) }),
  ),
});
export type EntityTruth = z.output<typeof entityTruthSchema>;

// A thing the household owns or holds. A subject of the system matches when its kind is
// the same and its label carries one of the `identifiers` (a plate, a contract number, a
// street) or equals the label or an alias.
const subjectTruthSchema = z.strictObject({
  key: keySchema,
  kind: subjectKindSchema,
  label: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  identifiers: z.array(z.string().min(1)),
});
export type SubjectDefinition = z.output<typeof subjectTruthSchema>;

export const corpusSchema = z.strictObject({
  version: z.literal(1),
  // The label every generated number and every grain of noise derives from.
  seed: z.string().min(1),
  // "Today" in the scenario: the day the household looks at its documents.
  reference_date: isoDateSchema,
  // The entity whose documents these are.
  owner: keySchema,
  entities: z.array(entityTruthSchema),
  subjects: z.array(subjectTruthSchema),
  documents: z.array(groundTruthSchema),
});

export type Corpus = z.output<typeof corpusSchema>;
