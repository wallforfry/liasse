import { z } from 'zod';
import { entityIdentifierTypeSchema, entityKindSchema } from '../domain/schemas.ts';
import { listEntities as listStoredEntities, listEntitiesOptionsSchema } from '../entities/list.ts';
import type { ApiContext } from './context.ts';

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

/** Entities with their document count. Names come from documents: untrusted content. */
export const listEntities = async (
  { db }: Pick<ApiContext, 'db'>,
  request: ListEntitiesRequest = {},
): Promise<EntityListView> => {
  const { include_private, ...options } = listEntitiesRequestSchema.parse(request);
  const { entities, total } = await listStoredEntities(
    { db },
    { ...options, includePrivate: include_private },
  );
  return {
    entities: entities.map(({ canonicalName, documentCount, aliases, identifiers, ...entity }) => ({
      ...entity,
      canonical_name: canonicalName,
      aliases: [...aliases],
      identifiers: identifiers.map((identifier) => ({ ...identifier })),
      document_count: documentCount,
    })),
    total,
  };
};
