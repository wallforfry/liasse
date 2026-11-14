import { and, asc, cosineDistance, eq, isNotNull, ne } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { TypeStatus } from '../domain/enums.ts';
import type { Embedding } from '../models/ports.ts';
import type { RegistryReadContext } from './context.ts';
import { exampleTitles } from './example-titles.ts';
import {
  findLiveTypeByName,
  type RegisteredType,
  toRegisteredType,
  TYPE_COLUMNS,
} from './type-store.ts';

export const EXAMPLE_TITLES_PER_TYPE = 3;
export const DEFAULT_CLOSEST_TYPES = 8;

// Follows a merge to its target: the slug and the aliases of a merged type are aliases of
// the type that absorbed it.
export const resolveType = (
  slugOrAlias: string,
  { db }: RegistryReadContext,
): Promise<RegisteredType | undefined> => findLiveTypeByName(db, slugOrAlias);

export interface ListTypesOptions {
  // Without a status, every type that is not merged.
  readonly status?: TypeStatus | undefined;
  readonly includeExamples?: boolean | undefined;
}

export interface ListedType extends RegisteredType {
  // Counted from `documents` on every read, so it cannot drift from them.
  readonly docCount: number;
  readonly examples?: readonly string[];
}

export const listTypes = async (
  { status, includeExamples = false }: ListTypesOptions,
  { db }: RegistryReadContext,
): Promise<readonly ListedType[]> => {
  const rows = await db
    .select({ ...TYPE_COLUMNS, docCount: db.$count(documents, eq(documents.typeId, docTypes.id)) })
    .from(docTypes)
    .where(status === undefined ? ne(docTypes.status, 'merged') : eq(docTypes.status, status))
    .orderBy(asc(docTypes.slug));
  const titles = includeExamples
    ? await exampleTitles(
        db,
        rows.map(({ id }) => id),
        EXAMPLE_TITLES_PER_TYPE,
      )
    : undefined;
  return rows.map(({ docCount, ...row }) => ({
    ...toRegisteredType(row),
    docCount,
    ...(titles === undefined ? {} : { examples: titles.get(row.id) ?? [] }),
  }));
};

export interface ClosestType {
  readonly type: RegisteredType;
  // Cosine similarity between the given embedding and the one of the description.
  readonly similarity: number;
  readonly exampleTitle: string | null;
}

export const closestTypes = async (
  embedding: Embedding,
  { db }: RegistryReadContext,
  k: number = DEFAULT_CLOSEST_TYPES,
): Promise<readonly ClosestType[]> => {
  const distance = cosineDistance(docTypes.embedding, [...embedding]);
  const rows = await db
    .select({ ...TYPE_COLUMNS, distance })
    .from(docTypes)
    .where(and(ne(docTypes.status, 'merged'), isNotNull(docTypes.embedding)))
    .orderBy(asc(distance), asc(docTypes.slug))
    .limit(k);
  const titles = await exampleTitles(
    db,
    rows.map(({ id }) => id),
    1,
  );
  return rows.map(({ distance: gap, ...row }) => ({
    type: toRegisteredType(row),
    similarity: 1 - Number(gap),
    exampleTitle: titles.get(row.id)?.[0] ?? null,
  }));
};
