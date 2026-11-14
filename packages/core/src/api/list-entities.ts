import {
  type EntityListView,
  type ListEntitiesRequest,
  listEntitiesRequestSchema,
} from '../contract/registry.ts';
import { listEntities as listStoredEntities } from '../entities/list.ts';
import type { ApiContext } from './context.ts';

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
