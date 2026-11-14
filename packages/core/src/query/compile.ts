import { type SQL, sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { fieldIdentity, fieldValue, outputValue, sortKey } from './access.ts';
import type { CheckedQuery } from './check.ts';
import type { AggregateShape, CheckedAggregate, RowsShape } from './check-shape.ts';
import { conditionSql, type EntityIds } from './condition-sql.ts';
import type { AggregateFunction, OrderDirection } from './dsl.ts';
import type { QueryField } from './fields.ts';
import { documentSource, isLiveDocument, liveType } from './source.ts';

export interface CompileContext {
  // The id of the type the query names, once resolved.
  readonly typeId?: string;
  readonly entityIds: EntityIds;
}

const COMMA = sql`, `;

const filter = (query: CheckedQuery, { typeId, entityIds }: CompileContext): SQL =>
  sql.join(
    [
      isLiveDocument,
      ...(query.includePrivate ? [] : [sql`NOT ${documents.private}`]),
      ...(typeId === undefined ? [] : [sql`${liveType.id} = ${typeId}`]),
      ...query.conditions.map((condition) => sql`(${conditionSql(condition, entityIds)})`),
    ],
    sql` AND `,
  );

// One more than asked: its presence says there is a next page.
const page = ({ limit, offset }: CheckedQuery): SQL => sql`LIMIT ${limit + 1} OFFSET ${offset}`;

const DIRECTION: Readonly<Record<OrderDirection, SQL>> = { asc: sql`ASC`, desc: sql`DESC` };

// Every row carries the same columns, whatever the query selects: the selection is
// applied to the result, and the statement does not depend on it. The instant is written
// as ISO 8601 here because the driver hands a raw `timestamptz` over in the session format.
const ROW_COLUMNS = sql`${documents.id} AS "id", ${liveType.slug} AS "type",
  ${documents.title} AS "title", ${documents.core} AS "core", ${documents.fields} AS "fields",
  ${documents.status}::text AS "status", ${documents.state}::text AS "state",
  to_char(${documents.ingestedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "ingested_at",
  ${documents.confidence} AS "confidence", ${documents.private} AS "private"`;

const rowsStatement = (query: CheckedQuery, { order }: RowsShape, context: CompileContext): SQL => {
  const ordering =
    order === undefined
      ? sql``
      : sql`${sortKey(order.field, fieldValue(order.field))} ${DIRECTION[order.direction]} NULLS LAST, `;
  return sql`SELECT ${ROW_COLUMNS} FROM ${documentSource} WHERE ${filter(query, context)}
    ORDER BY ${ordering}${documents.id} ASC ${page(query)}`;
};

const named = (prefix: string, index: number): SQL =>
  sql`${sql.identifier(`${prefix}${String(index)}`)}`;

export const GROUP_COLUMN = 'g';
export const AGGREGATE_COLUMN = 'a';
const KEY = 'k';
const VALUE = 'v';

const AGGREGATE: Readonly<Record<AggregateFunction, (value: SQL, field: QueryField) => SQL>> = {
  count: (value) => sql`COUNT(${value})::int`,
  sum: (value) => sql`SUM(${value})::float8`,
  avg: (value) => sql`AVG(${value})::float8`,
  min: (value, field) => outputValue(field, sql`MIN(${value})`),
  max: (value, field) => outputValue(field, sql`MAX(${value})`),
};

const aggregateSql = ({ fn, field }: CheckedAggregate, index: number): SQL =>
  field === undefined ? sql`COUNT(*)::int` : AGGREGATE[fn](named(VALUE, index), field);

// The filtered documents are projected first, each key and each aggregated value under a
// generated name, and aggregated outside: a key is a bound expression, and Postgres
// cannot tell that two of them with different parameter numbers are the same.
const aggregateStatement = (
  query: CheckedQuery,
  { aggregates, groupBy }: AggregateShape,
  context: CompileContext,
): SQL => {
  const projected = [
    sql`${documents.id}`,
    ...groupBy.map((field, index) => sql`${fieldIdentity(field)} AS ${named(KEY, index)}`),
    ...aggregates.flatMap(({ field }, index) =>
      field === undefined ? [] : [sql`${fieldValue(field)} AS ${named(VALUE, index)}`],
    ),
  ];
  const selected = [
    ...groupBy.map(
      (field, index) =>
        sql`${outputValue(field, named(KEY, index))} AS ${named(GROUP_COLUMN, index)}`,
    ),
    ...aggregates.map(
      (aggregate, index) =>
        sql`${aggregateSql(aggregate, index)} AS ${named(AGGREGATE_COLUMN, index)}`,
    ),
  ];
  const keys = groupBy.map((_, index) => named(KEY, index));
  const order = groupBy.map(
    (field, index) => sql`${sortKey(field, named(KEY, index))} ASC NULLS LAST`,
  );
  const grouping =
    keys.length === 0
      ? sql``
      : sql`GROUP BY ${sql.join(keys, COMMA)} ORDER BY ${sql.join(order, COMMA)}`;
  return sql`SELECT ${sql.join(selected, COMMA)}
    FROM (SELECT ${sql.join(projected, COMMA)} FROM ${documentSource}
      WHERE ${filter(query, context)}) AS "filtered"
    ${grouping} ${page(query)}`;
};

// One statement, whose text depends only on the shape of the query: every field name and
// every value of the query is a bound parameter.
export const compileQuery = (query: CheckedQuery, context: CompileContext): SQL =>
  query.shape.kind === 'rows'
    ? rowsStatement(query, query.shape, context)
    : aggregateStatement(query, query.shape, context);
