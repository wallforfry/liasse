import { MAX_QUERY_SUGGESTED_NAMES } from '../domain/limits.ts';
import { err, ok, type Result } from '../registry/result.ts';
import type { CheckedCondition } from './check-conditions.ts';
import type { EntityIds } from './condition-sql.ts';
import { existingEntityIds, idsByKey, queryNameKey, readEntities } from './entity-index.ts';
import { suggestEntities, type SuggestionScope } from './entity-suggestions.ts';
import {
  cut,
  failure,
  type QueryError,
  type QueryLocation,
  quoted,
  type UnknownEntity,
} from './errors.ts';

interface EntityReference {
  readonly name: string;
  readonly at: QueryLocation;
}

const references = (conditions: readonly CheckedCondition[]): readonly EntityReference[] =>
  conditions.flatMap((condition) => {
    if (condition.kind === 'equals' && condition.field.identity !== undefined) {
      return condition.values.flatMap((name) =>
        typeof name === 'string' ? [{ name, at: condition.at }] : [],
      );
    }
    return condition.kind === 'member' &&
      condition.field.itemIdentities !== undefined &&
      typeof condition.item === 'string'
      ? [{ name: condition.item, at: condition.at }]
      : [];
  });

const unknownEntity = (
  name: string,
  at: QueryLocation,
  suggestions: readonly string[],
): UnknownEntity => ({
  code: 'unknown_entity',
  message: `No entity has the name or the id ${quoted(name)}, so it stands for no document.${suggestions.length === 0 ? '' : ' Close names are in "suggestions".'}`,
  path: at,
  name: cut(name),
  suggestions,
});

export interface ResolvedEntities {
  readonly entityIds: EntityIds;
  // One per name no entity bears, however many conditions repeat it.
  readonly warnings: readonly UnknownEntity[];
}

const NOTHING: ResolvedEntities = { entityIds: new Map(), warnings: [] };

const idsOfThemselves = (ids: readonly string[]): EntityIds => new Map(ids.map((id) => [id, [id]]));

// What each name or id of entity of the query stands for. The work done here is bounded
// whatever the table holds: an id is looked up by key, names are matched over a bounded
// read, each distinct unknown name is reported once, and only the first few get
// suggestions.
export const resolveEntities = async (
  conditions: readonly CheckedCondition[],
  scope: SuggestionScope,
): Promise<Result<ResolvedEntities, readonly QueryError[]>> => {
  const referenced = references(conditions);
  const firstPlace = new Map(referenced.toReversed().map(({ name, at }) => [name, at]));
  const names = [...new Set(referenced.map(({ name }) => name))];
  if (names.length === 0) return ok(NOTHING);
  const ids = await existingEntityIds(names, scope);
  if (!ids.ok) return ids;
  const [firstName] = names.filter((name) => !ids.value.has(name));
  if (firstName === undefined) return ok({ ...NOTHING, entityIds: idsOfThemselves(names) });
  const known = await readEntities(scope);
  if (!known.ok) return known;
  if (known.value.length > scope.maxEntities) {
    return err([
      failure(
        'too_many_entities',
        firstPlace.get(firstName) ?? [],
        `A name is compared with at most ${String(scope.maxEntities)} entities and more exist: give the id of the entity instead of its name.`,
      ),
    ]);
  }
  const byKey = idsByKey(known.value);
  const entityIds = new Map(
    names.map((name) => [
      name,
      ids.value.has(name) ? [name] : (byKey.get(queryNameKey(name)) ?? []),
    ]),
  );
  const unknown = names.filter((name) => entityIds.get(name)?.length === 0);
  const suggestions = await suggestEntities(
    unknown.slice(0, MAX_QUERY_SUGGESTED_NAMES),
    known.value,
    scope,
  );
  if (!suggestions.ok) return suggestions;
  return ok({
    entityIds,
    warnings: unknown.map((name) =>
      unknownEntity(name, firstPlace.get(name) ?? [], suggestions.value.get(name) ?? []),
    ),
  });
};
