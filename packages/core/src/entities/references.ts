import { and, arrayContains, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { typeChanges } from '../db/schema/registry.ts';
import { PROVENANCE_ENTITY_ID_KEY } from '../domain/provenance.ts';
import type { EntityReader, EntityTransaction } from './entity-store.ts';

// Every place an entity id lives outside `entities`. None of them has a foreign key
// (JSON and array columns), so this module is what keeps them true: a new place that
// holds an entity id is added here, and the scan in `merge.test.ts` fails until it is.
//
// - `documents.provenance`: `entity_id` in the entry of an entity-typed value, at any
//   depth (the entry of a list field is an array). The value itself, in `core` or
//   `fields`, is the name as the document writes it and holds no id.
// - `facts.entity_ids`.
// - `type_changes.payload` of a `merge_entity` proposal, pending or rejected.

// Every `entity_id` of a provenance, whatever the field: the entry of a plain field, and
// each entry of a list field, which the lax mode of the path unwraps.
const EVERY_ENTITY_ID = `$.*."${PROVENANCE_ENTITY_ID_KEY}"`;

export interface DocumentCountOptions {
  // Private documents are left out unless asked for, as search and queries do.
  readonly includePrivate?: boolean | undefined;
}

// How many documents name each entity in an entity-typed field, core or not. A document
// that names the same entity twice counts once, and a tombstone is not a document.
export const countDocumentsByEntity = async (
  reader: EntityReader,
  entityIds: readonly string[],
  { includePrivate = false }: DocumentCountOptions = {},
): Promise<ReadonlyMap<string, number>> => {
  if (entityIds.length === 0) return new Map();
  const referenced = sql<string>`(referenced.entry #>> '{}')`;
  const rows = await reader
    .select({ entityId: referenced, total: sql<number>`count(DISTINCT ${documents.id})::int` })
    .from(
      sql`${documents} CROSS JOIN LATERAL jsonb_path_query(
        ${documents.provenance}, ${EVERY_ENTITY_ID}::jsonpath
      ) AS referenced(entry)`,
    )
    .where(
      and(
        inArray(referenced, [...entityIds]),
        isLiveDocument,
        includePrivate ? undefined : eq(documents.private, false),
      ),
    )
    .groupBy(referenced);
  return new Map(rows.map(({ entityId, total }) => [entityId, total]));
};

// The rewrites work on the text of a JSON column. An id is a prefix and Crockford base32
// characters: its JSON form is itself between quotes, with nothing to escape, and inside
// a longer JSON string a quote is written `\"`. So the quoted id is only found where a
// whole string is that id, and `jsonb` always prints a member as `"key": value`.
const quoted = (id: string): string => `"${id}"`;
const entityIdMember = (id: string): string => `${quoted(PROVENANCE_ENTITY_ID_KEY)}: ${quoted(id)}`;

const contains = (column: PgColumn, text: string): SQL => sql`strpos(${column}::text, ${text}) > 0`;

const replaced = (column: PgColumn, from: string, to: string): SQL =>
  sql`replace(${column}::text, ${from}, ${to})::jsonb`;

const rewriteProvenance = async (
  tx: EntityTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  const member = entityIdMember(sourceId);
  await tx
    .update(documents)
    .set({ provenance: replaced(documents.provenance, member, entityIdMember(targetId)) })
    .where(contains(documents.provenance, member));
};

// A fact about both entities names the target once, where it was first.
const rewriteFacts = async (
  tx: EntityTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await tx
    .update(facts)
    .set({
      entityIds: sql`ARRAY(
        SELECT entity_id
        FROM unnest(array_replace(${facts.entityIds}, ${sourceId}, ${targetId}))
          WITH ORDINALITY AS listed(entity_id, position)
        GROUP BY entity_id
        ORDER BY min(position)
      )`,
    })
    .where(arrayContains(facts.entityIds, [sourceId]));
};

// A proposal about the source and a third entity is now about the target: a pending one
// stays applicable, and a rejected one keeps the pair from being proposed again. One
// between the source and the target describes this very merge: it is left as written,
// for whoever applies it to close. An applied one is history and keeps its ids.
const rewritePendingMerges = async (
  tx: EntityTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await tx
    .update(typeChanges)
    .set({ payload: replaced(typeChanges.payload, quoted(sourceId), quoted(targetId)) })
    .where(
      and(
        eq(typeChanges.kind, 'merge_entity'),
        inArray(typeChanges.status, ['pending', 'rejected']),
        contains(typeChanges.payload, quoted(sourceId)),
        sql`NOT ${contains(typeChanges.payload, quoted(targetId))}`,
      ),
    );
};

// Points every reference to the source at the target. Both ids must be well-formed
// entity ids: the caller has read both entities.
export const rewriteEntityReferences = async (
  tx: EntityTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await rewriteProvenance(tx, sourceId, targetId);
  await rewriteFacts(tx, sourceId, targetId);
  await rewritePendingMerges(tx, sourceId, targetId);
};
