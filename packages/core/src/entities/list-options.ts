import { z } from 'zod';
import { MAX_ENTITY_NAME_LENGTH } from '../domain/limits.ts';
import { entityKindSchema } from '../domain/schemas.ts';

export const DEFAULT_ENTITY_LIST_LIMIT = 50;
export const MAX_ENTITY_LIST_LIMIT = 200;

export const listEntitiesOptionsSchema = z.strictObject({
  // Words of a name, in any order, each one possibly cut short: "synth ener".
  query: z.string().trim().min(1).max(MAX_ENTITY_NAME_LENGTH).optional(),
  kind: entityKindSchema.optional(),
  limit: z.int().min(1).max(MAX_ENTITY_LIST_LIMIT).default(DEFAULT_ENTITY_LIST_LIMIT),
  offset: z.int().min(0).default(0),
  // Whether the document counts include the documents flagged `private`.
  includePrivate: z.boolean().default(false),
});
export type ListEntitiesOptions = z.input<typeof listEntitiesOptionsSchema>;
