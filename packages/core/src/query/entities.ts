import type { Database } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import { normalizeEntityName } from '../domain/entity-name.ts';
import { MAX_QUERY_SUGGESTED_ENTITIES } from '../domain/limits.ts';
import type { CheckedCondition } from './check-conditions.ts';
import { editDistance, isClose, rankByDistance } from './closest.ts';
import type { EntityIds } from './condition-sql.ts';
import { type QueryLocation, quoted, type QueryWarning } from './errors.ts';

interface KnownEntity {
  readonly id: string;
  readonly canonicalName: string;
  // The canonical name and the aliases, each as the normaliser of entity names writes it.
  readonly keys: readonly string[];
}

const keyOf = (name: string): string => normalizeEntityName(name).join(' ');

interface EntityReference {
  readonly name: string;
  readonly at: QueryLocation;
}

const references = (conditions: readonly CheckedCondition[]): readonly EntityReference[] =>
  conditions.flatMap((condition) =>
    condition.kind === 'equals' && condition.field.identity !== undefined
      ? condition.values.flatMap((name) =>
          typeof name === 'string' ? [{ name, at: condition.at }] : [],
        )
      : [],
  );

const loadEntities = async (db: Database): Promise<readonly KnownEntity[]> => {
  const rows = await db
    .select({ id: entities.id, canonicalName: entities.canonicalName, aliases: entities.aliases })
    .from(entities)
    .orderBy(entities.id);
  return rows.map(({ id, canonicalName, aliases }) => ({
    id,
    canonicalName,
    keys: [canonicalName, ...aliases].map(keyOf),
  }));
};

// An id stands for itself; a name stands for every entity that bears it, as its
// canonical name or as an alias, once both are normalised the same way.
const idsOf = (reference: string, known: readonly KnownEntity[]): readonly string[] => {
  if (known.some(({ id }) => id === reference)) return [reference];
  const key = keyOf(reference);
  return known.filter(({ keys }) => keys.includes(key)).map(({ id }) => id);
};

const closeNames = (reference: string, known: readonly KnownEntity[]): readonly string[] => {
  const key = keyOf(reference);
  const distanceOf = ({ keys }: KnownEntity): number =>
    Math.min(...keys.map((candidate) => editDistance(key, candidate)));
  return rankByDistance(known, distanceOf)
    .filter(({ distance }) => isClose(distance, key))
    .slice(0, MAX_QUERY_SUGGESTED_ENTITIES)
    .map(({ item }) => item.canonicalName);
};

const unknownEntity = (
  { name, at }: EntityReference,
  known: readonly KnownEntity[],
): QueryWarning => {
  const close = closeNames(name, known);
  return {
    code: 'unknown_entity',
    message: `No entity has the name or the id ${quoted(name)}, so it stands for no document.${close.length === 0 ? '' : ` Close names: ${close.join(', ')}.`}`,
    path: at,
  };
};

export interface ResolvedEntities {
  readonly entityIds: EntityIds;
  readonly warnings: readonly QueryWarning[];
}

// The entities are read only when the query compares one, and matched in memory: the
// normaliser of entity names is the one definition of what makes two names equal, and
// it does not exist in SQL.
export const resolveEntities = async (
  conditions: readonly CheckedCondition[],
  db: Database,
): Promise<ResolvedEntities> => {
  const referenced = references(conditions);
  if (referenced.length === 0) return { entityIds: new Map(), warnings: [] };
  const known = await loadEntities(db);
  const entityIds = new Map(referenced.map(({ name }) => [name, idsOf(name, known)]));
  return {
    entityIds,
    warnings: referenced
      .filter(({ name }) => entityIds.get(name)?.length === 0)
      .map((reference) => unknownEntity(reference, known)),
  };
};
