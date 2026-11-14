import { z } from 'zod';
import {
  changeKindSchema,
  entityIdentifierTypeSchema,
  entityKindSchema,
  keyDateKindSchema,
  subjectKindSchema,
  typeStatusSchema,
} from '../domain/schemas.ts';
import { listEntitiesOptionsSchema } from '../entities/list-options.ts';
import { fieldDefinitionSchema } from '../registry/primitives.ts';

export const describeTypesOptionsSchema = z.strictObject({
  status: typeStatusSchema.optional().describe('Without it, every type that is not merged.'),
  include_examples: z.boolean().default(false),
  include_private: z
    .boolean()
    .default(false)
    .describe('Whether the document counts include private documents.'),
});
export type DescribeTypesOptions = z.input<typeof describeTypesOptionsSchema>;

export const typeListSchema = z.object({
  types: z.array(
    z.object({
      slug: z.string(),
      description: z.string(),
      parent_slug: z.string().nullable(),
      version: z.int(),
      status: typeStatusSchema,
      aliases: z.array(z.string()),
      fields: z.record(z.string(), fieldDefinitionSchema),
      document_count: z.int(),
      examples: z.array(z.string()).optional().describe('Titles of documents of the type.'),
    }),
  ),
});
export type TypeList = z.output<typeof typeListSchema>;

const { includePrivate, ...sameNameOptions } = listEntitiesOptionsSchema.shape;

// The options of `listEntities` of the entities module, under snake_case names.
export const listEntitiesRequestSchema = z.strictObject({
  ...sameNameOptions,
  include_private: includePrivate.describe(
    'Whether the document counts include private documents.',
  ),
});
export type ListEntitiesRequest = z.input<typeof listEntitiesRequestSchema>;

export const entityListSchema = z.object({
  entities: z.array(
    z.object({
      id: z.string(),
      kind: entityKindSchema,
      canonical_name: z.string(),
      aliases: z.array(z.string()),
      identifiers: z.array(
        z.object({
          type: entityIdentifierTypeSchema,
          value: z.string().describe('Masked for an IBAN or a card number.'),
          format: z.string().optional(),
        }),
      ),
      document_count: z.int(),
    }),
  ),
  total: z.int(),
});
export type EntityListView = z.output<typeof entityListSchema>;

const isoDate = z.iso.date();

export const listSubjectsOptionsSchema = z.strictObject({
  query: z.string().trim().min(1).optional(),
  kind: subjectKindSchema.optional(),
});
export type ListSubjectsOptions = z.output<typeof listSubjectsOptionsSchema>;

export const upcomingOptionsSchema = z.strictObject({
  from: isoDate,
  to: isoDate,
  kinds: z.array(keyDateKindSchema).min(1).optional(),
  types: z.array(z.string().min(1)).min(1).optional(),
  subject: z.string().min(1).optional(),
  current_only: z.boolean().default(true),
});
export type UpcomingOptions = z.output<typeof upcomingOptionsSchema>;

export const listChangesOptionsSchema = z.strictObject({
  kind: changeKindSchema.optional(),
});
export type ListChangesOptions = z.output<typeof listChangesOptionsSchema>;

export const CHANGE_DECISIONS = ['apply', 'reject'] as const;
export const changeDecisionSchema = z.strictObject({
  decision: z.enum(CHANGE_DECISIONS),
  note: z.string().trim().min(1).max(2000).optional(),
});
export type ChangeDecision = z.output<typeof changeDecisionSchema>;

// The modules behind subjects, key dates and changes define their answers; until they
// are bound, the contract only says an object comes back.
export const featureResultSchema = z.looseObject({});
export type FeatureResult = z.output<typeof featureResultSchema>;
