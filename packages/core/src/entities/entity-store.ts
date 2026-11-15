import type { EntityKind } from '@liasse/contract/domain';
import { and, asc, cosineDistance, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { entities } from '../db/schema/registry.ts';
import type { Embedding } from '../models/ports.ts';
import {
  parseIdentifiersColumn,
  type StoredIdentifier,
  toIdentifiersColumn,
} from './identifiers.ts';

export type EntityTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type EntityReader = Database | EntityTransaction;

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly identifiers: readonly StoredIdentifier[];
}

// The embedding is left out: no reader of an entity needs its few hundred numbers.
const ENTITY_COLUMNS = {
  id: entities.id,
  kind: entities.kind,
  canonicalName: entities.canonicalName,
  aliases: entities.aliases,
  identifiers: entities.identifiers,
} as const;

interface EntityRow extends Omit<Entity, 'identifiers'> {
  readonly identifiers: unknown;
}

const toEntity = ({ identifiers, ...row }: EntityRow): Entity => ({
  ...row,
  identifiers: parseIdentifiersColumn(identifiers),
});

const ofKind = (kind: EntityKind | undefined) =>
  kind === undefined ? undefined : eq(entities.kind, kind);

// Oldest first: ids sort by creation time, which makes every "first match" deterministic.
export const loadEntities = async (
  reader: EntityReader,
  kind?: EntityKind,
): Promise<readonly Entity[]> =>
  (
    await reader.select(ENTITY_COLUMNS).from(entities).where(ofKind(kind)).orderBy(asc(entities.id))
  ).map(toEntity);

export const findEntityById = async (
  reader: EntityReader,
  id: string,
): Promise<Entity | undefined> => {
  const [row] = await reader.select(ENTITY_COLUMNS).from(entities).where(eq(entities.id, id));
  return row === undefined ? undefined : toEntity(row);
};

// The ids among those given that no entity has, or no longer has after a merge. A caller
// that holds the entity lock resolves the mention of a missing id again only after its
// own transaction has ended: `resolveEntity` works on a connection of its own and would
// wait for that very lock.
export const missingEntityIds = async (
  reader: EntityReader,
  ids: readonly string[],
): Promise<readonly string[]> => {
  if (ids.length === 0) return [];
  const found = await reader
    .select({ id: entities.id })
    .from(entities)
    .where(inArray(entities.id, [...ids]));
  const known = new Set(found.map(({ id }) => id));
  return ids.filter((id) => !known.has(id));
};

export interface SimilarEntity {
  readonly entity: Entity;
  // Cosine similarity between the given embedding and the one of the entity.
  readonly similarity: number;
}

// Every entity at least that similar, closest first. No limit on their number: the
// caller leaves some out before it keeps the closest, and few entities are that close.
export const similarEntities = async (
  reader: EntityReader,
  embedding: Embedding,
  kind: EntityKind | undefined,
  minSimilarity: number,
): Promise<readonly SimilarEntity[]> => {
  const distance = cosineDistance(entities.embedding, [...embedding]);
  const rows = await reader
    .select({ ...ENTITY_COLUMNS, distance })
    .from(entities)
    .where(
      and(isNotNull(entities.embedding), ofKind(kind), sql`${distance} <= ${1 - minSimilarity}`),
    )
    .orderBy(asc(distance), asc(entities.id));
  return rows.map(({ distance: gap, ...row }) => ({
    entity: toEntity(row),
    similarity: 1 - Number(gap),
  }));
};

export interface NewEntity {
  readonly kind: EntityKind;
  readonly canonicalName: string;
  readonly identifiers: readonly StoredIdentifier[];
  readonly embedding: Embedding | undefined;
}

const written = (rows: readonly EntityRow[]): Entity => {
  const [row] = rows;
  if (row === undefined) throw new Error('The entity row was not written');
  return toEntity(row);
};

export const insertEntity = async (
  tx: EntityTransaction,
  { identifiers, embedding, ...values }: NewEntity,
): Promise<Entity> =>
  written(
    await tx
      .insert(entities)
      .values({
        ...values,
        identifiers: toIdentifiersColumn(identifiers),
        ...(embedding === undefined ? {} : { embedding }),
      })
      .returning(ENTITY_COLUMNS),
  );

export interface EntityNames {
  readonly aliases: readonly string[];
  readonly identifiers: readonly StoredIdentifier[];
}

// The target takes the names given and, when it has none, the embedding of the source;
// the source row is then deleted. References to the source are the caller's to rewrite.
export const absorbEntity = async (
  tx: EntityTransaction,
  sourceId: string,
  targetId: string,
  { aliases, identifiers }: EntityNames,
): Promise<Entity> => {
  const merged = written(
    await tx
      .update(entities)
      .set({
        aliases,
        identifiers: toIdentifiersColumn(identifiers),
        embedding: sql`COALESCE(${entities.embedding}, (
          SELECT absorbed.embedding FROM ${entities} AS absorbed WHERE absorbed.id = ${sourceId}
        ))`,
      })
      .where(eq(entities.id, targetId))
      .returning(ENTITY_COLUMNS),
  );
  await tx.delete(entities).where(eq(entities.id, sourceId));
  return merged;
};

export const updateEntityNames = async (
  tx: EntityTransaction,
  id: string,
  { aliases, identifiers }: EntityNames,
): Promise<Entity> =>
  written(
    await tx
      .update(entities)
      .set({ aliases, identifiers: toIdentifiersColumn(identifiers) })
      .where(eq(entities.id, id))
      .returning(ENTITY_COLUMNS),
  );
