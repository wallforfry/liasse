import {
  type EntityListView,
  type EntityView,
  type GetEntityRequest,
  getEntityRequestSchema,
  type ListEntitiesRequest,
  listEntitiesRequestSchema,
} from '@liasse/contract';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import {
  getEntity as getStoredEntity,
  type ListedEntity,
  listEntities as listStoredEntities,
} from '../entities/list.ts';
import type { ApiContext } from './context.ts';
import { entityNotFound } from './errors.ts';

const toEntityView = ({
  canonicalName,
  documentCount,
  aliases,
  identifiers,
  ...entity
}: ListedEntity): EntityView => ({
  ...entity,
  canonical_name: canonicalName,
  aliases: [...aliases],
  identifiers: identifiers.map((identifier) => ({ ...identifier })),
  document_count: documentCount,
});

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
  return { entities: entities.map(toEntityView), total };
};

/**
 * One entity with its document count. Rejects with `entity_not_found` for an id no
 * entity has, such as the source of a merge, which a merge deletes.
 */
export const getEntity = async (
  { db }: Pick<ApiContext, 'db'>,
  id: string,
  request: GetEntityRequest = {},
): Promise<EntityView> => {
  const { include_private } = getEntityRequestSchema.parse(request);
  // An id that is not well-formed names no entity, and is never sent to the database.
  const entity = isId(ID_PREFIXES.entity, id)
    ? await getStoredEntity({ db }, id, { includePrivate: include_private })
    : undefined;
  if (entity === undefined) throw entityNotFound();
  return toEntityView(entity);
};
