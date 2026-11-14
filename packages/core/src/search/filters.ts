import { type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { SearchFilters } from './input.ts';

// `core` stores an entity field as an object that carries the id of the resolved entity.
const ENTITY_FIELDS = ['issuer', 'recipient'] as const;
const ENTITY_ID_KEY = 'entity_id';
const DOCUMENT_DATE_KEY = 'document_date';

const MERGED_TYPES = 'merged_types';
const mergedTypes = alias(docTypes, MERGED_TYPES);

// A slug or an alias names a type. A merged type keeps its row and its slug becomes an alias of
// its target, so the documents still attached to it belong to the named type as well.
const ofType = (type: string): SQL => {
  const named = sql`(${docTypes.slug} = ${type} OR ${type} = ANY(${docTypes.aliases}))`;
  return sql`${documents.typeId} IN (
    SELECT ${docTypes.id} FROM ${docTypes} WHERE ${named}
    UNION
    SELECT ${mergedTypes.id}
    FROM ${docTypes} AS ${sql.identifier(MERGED_TYPES)}
    JOIN ${docTypes} ON ${mergedTypes.slug} = ANY(${docTypes.aliases})
    WHERE ${mergedTypes.status} = 'merged' AND ${named}
  )`;
};

const ofEntity = (entity: string): SQL =>
  sql`(${sql.join(
    ENTITY_FIELDS.map(
      (field) =>
        sql`${documents.core} -> ${sql.raw(`'${field}'`)} ->> ${sql.raw(`'${ENTITY_ID_KEY}'`)} = ${entity}`,
    ),
    sql` OR `,
  )})`;

// ISO dates compare like text, and a text comparison cannot raise on a malformed stored value
// the way a cast to date would.
const documentDate = sql`${documents.core} ->> ${sql.raw(`'${DOCUMENT_DATE_KEY}'`)}`;

// A predicate over `documents`, applied inside each candidate query so that a filter narrows
// the candidates instead of thinning an already limited list.
export const documentFilter = (filters: SearchFilters, includePrivate: boolean): SQL => {
  const conditions = [
    ...(includePrivate ? [] : [sql`NOT ${documents.private}`]),
    ...(filters.type === undefined ? [] : [ofType(filters.type)]),
    ...(filters.entity === undefined ? [] : [ofEntity(filters.entity)]),
    ...(filters.subject === undefined
      ? []
      : [sql`${documents.subjectIds} @> ARRAY[${filters.subject}]::text[]`]),
    ...(filters.dateFrom === undefined ? [] : [sql`${documentDate} >= ${filters.dateFrom}`]),
    ...(filters.dateTo === undefined ? [] : [sql`${documentDate} <= ${filters.dateTo}`]),
    ...(filters.status === undefined ? [] : [sql`${documents.status} = ${filters.status}`]),
  ];
  return conditions.length === 0 ? sql`true` : sql.join(conditions, sql` AND `);
};
