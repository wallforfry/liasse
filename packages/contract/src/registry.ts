import { z } from 'zod';
import { MAX_TYPE_REQUEST_LENGTH } from './domain/limits.ts';
import {
  changeKindSchema,
  entityIdentifierTypeSchema,
  entityKindSchema,
  keyDateKindSchema,
  subjectKindSchema,
  typeStatusSchema,
} from './domain/schemas.ts';
import { listEntitiesOptionsSchema } from './entities/list-options.ts';
import { fieldDefinitionSchema } from './registry/primitives.ts';

export const describeTypesOptionsSchema = z.strictObject({
  status: typeStatusSchema.optional().describe('Without it, every type that is not merged.'),
  include_examples: z.boolean().default(false),
  include_private: z
    .boolean()
    .default(false)
    .describe('Whether the document counts include private documents.'),
});
export type DescribeTypesOptions = z.input<typeof describeTypesOptionsSchema>;

const typeViewSchema = z.object({
  slug: z.string(),
  description: z.string(),
  parent_slug: z.string().nullable(),
  version: z.int(),
  status: typeStatusSchema,
  aliases: z.array(z.string()),
  fields: z.record(z.string(), fieldDefinitionSchema),
  document_count: z.int(),
  examples: z.array(z.string()).optional().describe('Titles of documents of the type.'),
});
export type TypeView = z.output<typeof typeViewSchema>;

export const typeListSchema = z.object({ types: z.array(typeViewSchema) });
export type TypeList = z.output<typeof typeListSchema>;

// The registry judges the slug, the description, the parent and the field names with
// its naming rules; the schema only gives the request its shape.
export const createTypeRequestSchema = z.strictObject({
  slug: z.string().describe('snake_case, English, generic to specific: `energy_bill`.'),
  description: z.string(),
  parent_slug: z
    .string()
    .nullable()
    .default(null)
    .describe('A type without a parent: the hierarchy has two levels.'),
  fields: z.record(z.string(), fieldDefinitionSchema).default({}),
});
export type CreateTypeRequest = z.input<typeof createTypeRequestSchema>;

// What a person wants a type for, in their own words: the text model drafts the type.
export const typeSuggestionRequestSchema = z.strictObject({
  request: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TYPE_REQUEST_LENGTH)
    .describe('The documents the type is for and what to read from them, in free text.'),
});
export type TypeSuggestionRequest = z.input<typeof typeSuggestionRequestSchema>;

// A draft, never stored: the registry judges it only when it is sent to create the type.
export const typeSuggestionSchema = z.object({
  slug: z.string(),
  description: z.string(),
  parent_slug: z.string().nullable(),
  fields: z.record(z.string(), fieldDefinitionSchema),
});
export type TypeSuggestion = z.output<typeof typeSuggestionSchema>;

export const createdTypeSchema = typeViewSchema.omit({ examples: true });
export type CreatedType = z.output<typeof createdTypeSchema>;

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
export const MAX_CHANGE_NOTE_LENGTH = 2000;
export const changeDecisionSchema = z.strictObject({
  decision: z.enum(CHANGE_DECISIONS),
  note: z.string().trim().min(1).max(MAX_CHANGE_NOTE_LENGTH).optional(),
});
export type ChangeDecision = z.output<typeof changeDecisionSchema>;
