import { err, ok, type Result } from '@liasse/contract/registry';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import type { EntitiesWriteContext } from './context.ts';
import { withEntityLock } from './entity-lock.ts';
import { absorbEntity, type Entity, type EntityReader, findEntityById } from './entity-store.ts';
import { type EntityMergeError, entityNotFound, kindMismatch, selfMerge } from './errors.ts';
import { withAliases } from './exact-match.ts';
import { mergeIdentifiers } from './identifiers.ts';
import { rewriteEntityReferences } from './references.ts';

export interface EntityPair {
  readonly sourceId: string;
  readonly targetId: string;
}

interface MergeablePair {
  readonly source: Entity;
  readonly target: Entity;
}

// An id that is not well-formed names no entity, and is never sent to the database.
const findEntity = async (
  reader: EntityReader,
  id: string,
): Promise<Result<Entity, EntityMergeError>> => {
  const entity = isId(ID_PREFIXES.entity, id) ? await findEntityById(reader, id) : undefined;
  return entity === undefined ? err(entityNotFound(id)) : ok(entity);
};

export const findMergeablePair = async (
  reader: EntityReader,
  { sourceId, targetId }: EntityPair,
): Promise<Result<MergeablePair, EntityMergeError>> => {
  if (sourceId === targetId) return err(selfMerge(sourceId));
  const source = await findEntity(reader, sourceId);
  if (!source.ok) return source;
  const target = await findEntity(reader, targetId);
  if (!target.ok) return target;
  return source.value.kind === target.value.kind
    ? ok({ source: source.value, target: target.value })
    : err(kindMismatch(source.value.kind, target.value.kind));
};

// Merges the source into the target, all or nothing: the target takes the names and the
// identifiers of the source, every reference to the source is pointed at the target, and
// the source is deleted. Answers with the target as it is afterwards. Given a transaction
// instead of a database, the merge is part of it and commits or rolls back with it.
export const mergeEntities = (
  { db }: EntitiesWriteContext,
  pair: EntityPair,
): Promise<Result<Entity, EntityMergeError>> =>
  withEntityLock(db, async (tx) => {
    const found = await findMergeablePair(tx, pair);
    if (!found.ok) return found;
    const { source, target } = found.value;
    await rewriteEntityReferences(tx, source.id, target.id);
    return ok(
      await absorbEntity(tx, source.id, target.id, {
        aliases: withAliases(target, [source.canonicalName, ...source.aliases]),
        identifiers: mergeIdentifiers(target.identifiers, source.identifiers),
      }),
    );
  });
