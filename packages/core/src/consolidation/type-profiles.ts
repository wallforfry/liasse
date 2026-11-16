import { and, asc, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { SETTLED_STATUSES } from '@liasse/contract/domain';
import { type RegisteredType, toRegisteredType, TYPE_COLUMNS } from '../registry/type-store.ts';

/** What consolidation counts of a type, over its settled live documents. */
export interface TypeProfile {
  readonly type: RegisteredType;
  readonly documents: number;
  /** Documents that have each key in `extra`. */
  readonly extraKeys: ReadonlyMap<string, number>;
  /** Documents that have each field filled. */
  readonly filledFields: ReadonlyMap<string, number>;
  /** The entities the documents name as issuer. */
  readonly issuers: ReadonlySet<string>;
}

const settled = and(isLiveDocument, inArray(documents.status, [...SETTLED_STATUSES]));

const keyCountSchema = z.array(
  z.object({ type_id: z.string(), key: z.string(), documents: z.coerce.number() }),
);

const countKeys = async (
  db: Database,
  column: typeof documents.extra | typeof documents.fields,
): Promise<ReadonlyMap<string, ReadonlyMap<string, number>>> => {
  const rows = keyCountSchema.parse(
    await db.execute(sql`
      SELECT ${documents.typeId} AS type_id, entry.key AS key, count(*) AS documents
      FROM ${documents}, jsonb_object_keys(${column}) AS entry(key)
      WHERE ${documents.typeId} IS NOT NULL AND ${settled}
      GROUP BY 1, 2`),
  );
  return rows.reduce(
    (byType, { type_id: typeId, key, documents: count }) =>
      new Map(byType).set(typeId, new Map(byType.get(typeId)).set(key, count)),
    new Map<string, ReadonlyMap<string, number>>(),
  );
};

const issuerSchema = z.array(z.object({ type_id: z.string(), entity_id: z.string() }));

const issuersByType = async (db: Database): Promise<ReadonlyMap<string, ReadonlySet<string>>> => {
  const rows = issuerSchema.parse(
    await db.execute(sql`
      SELECT DISTINCT ${documents.typeId} AS type_id,
        ${documents.provenance} -> 'issuer' ->> 'entity_id' AS entity_id
      FROM ${documents}
      WHERE ${documents.typeId} IS NOT NULL AND ${settled}
        AND ${documents.provenance} -> 'issuer' ->> 'entity_id' IS NOT NULL`),
  );
  return rows.reduce(
    (byType, { type_id: typeId, entity_id: entityId }) =>
      new Map(byType).set(typeId, new Set(byType.get(typeId)).add(entityId)),
    new Map<string, ReadonlySet<string>>(),
  );
};

const documentCounts = async (db: Database): Promise<ReadonlyMap<string, number>> => {
  const rows = await db
    .select({ typeId: documents.typeId, count: sql<number>`count(*)::int` })
    .from(documents)
    .where(settled)
    .groupBy(documents.typeId);
  return new Map(rows.flatMap(({ typeId, count }) => (typeId === null ? [] : [[typeId, count]])));
};

/**
 * Every type that is not merged, with its counts. Private documents count like the
 * others: they make a key frequent or a field rare all the same, and nothing of them is
 * read here but names.
 */
export const loadTypeProfiles = async (db: Database): Promise<readonly TypeProfile[]> => {
  const [types, counts, extraKeys, filledFields, issuers] = await Promise.all([
    db
      .select(TYPE_COLUMNS)
      .from(docTypes)
      .where(ne(docTypes.status, 'merged'))
      .orderBy(asc(docTypes.id)),
    documentCounts(db),
    countKeys(db, documents.extra),
    countKeys(db, documents.fields),
    issuersByType(db),
  ]);
  return types.map((row) => ({
    type: toRegisteredType(row),
    documents: counts.get(row.id) ?? 0,
    extraKeys: extraKeys.get(row.id) ?? new Map(),
    filledFields: filledFields.get(row.id) ?? new Map(),
    issuers: issuers.get(row.id) ?? new Set(),
  }));
};
