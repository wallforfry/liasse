import { type SQL, sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import type { QueryPrimitive } from './capabilities.ts';
import type { JsonColumn, QueryField } from './fields.ts';

type Shaping = (value: SQL) => SQL;

const JSON_COLUMN: Readonly<Record<JsonColumn, SQL>> = {
  core: sql`${documents.core}`,
  fields: sql`${documents.fields}`,
};

// The keys are bound like any other value: no field name is ever part of the statement.
const jsonValue = (column: SQL, keys: readonly string[]): SQL =>
  sql`jsonb_extract_path(${column}, ${sql.join(
    keys.map((key) => sql`${key}::text`),
    sql`, `,
  )})`;

// A stored value that does not have the shape of its primitive reads as absent: the
// document then matches nothing but `exists: false`, and the statement never fails on
// a cast. Each cast sits behind the `CASE` that proves it applies.
const text: Shaping = (value) =>
  sql`CASE WHEN jsonb_typeof(${value}) = 'string' THEN ${value} #>> '{}' END`;

const numeric: Shaping = (value) =>
  sql`CASE WHEN jsonb_typeof(${value}) = 'number' THEN (${value} #>> '{}')::numeric END`;

const boolean: Shaping = (value) =>
  sql`CASE WHEN jsonb_typeof(${value}) = 'boolean' THEN (${value} #>> '{}')::boolean END`;

// `pg_input_is_valid` alone would let `today` or `8 January` through.
const date: Shaping = (value) =>
  sql`CASE WHEN jsonb_typeof(${value}) = 'string'
    AND ${value} #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND pg_input_is_valid(${value} #>> '{}', 'date')
    THEN (${value} #>> '{}')::date END`;

const object: Shaping = (value) =>
  sql`CASE WHEN jsonb_typeof(${value}) = 'object' THEN ${value} END`;

const array: Shaping = (value) => sql`CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${value} END`;

const SHAPING: Readonly<Record<QueryPrimitive, Shaping>> = {
  text,
  identifier: text,
  enum: text,
  entity: text,
  number: numeric,
  boolean,
  date,
  money: object,
  period: object,
  list: array,
  key_dates: array,
};

// The value of the field as the SQL type its primitive compares as, or NULL.
export const fieldValue = ({ source, primitive }: QueryField): SQL =>
  source.kind === 'column'
    ? source.expression
    : SHAPING[primitive](jsonValue(JSON_COLUMN[source.column], source.keys));

// What says that two documents hold the same thing: the entity a name was resolved to
// for an entity, which several names may share, and the value itself for anything else.
// A name that was not resolved has no identity.
export const fieldIdentity = (field: QueryField): SQL =>
  field.identity === undefined
    ? fieldValue(field)
    : text(jsonValue(sql`${documents.provenance}`, field.identity));

const textParameter = (value: unknown): SQL => sql`${value}::text`;

const TYPED_PARAMETER: Readonly<Partial<Record<QueryPrimitive, (value: unknown) => SQL>>> = {
  number: (value) => sql`${value}::numeric`,
  boolean: (value) => sql`${value}::boolean`,
  date: (value) => sql`${value}::date`,
};

// A checked value as a bound parameter of the type the field compares as.
export const fieldParameter = ({ primitive }: QueryField, value: unknown): SQL =>
  (TYPED_PARAMETER[primitive] ?? textParameter)(value);

const identity: Shaping = (value) => value;

const TEXTUAL: ReadonlySet<QueryPrimitive> = new Set(['text', 'identifier', 'enum', 'entity']);

// Texts are ordered by their bytes, so that the order does not follow the locale the
// database was created with.
export const sortKey = ({ primitive }: QueryField, value: SQL): SQL =>
  TEXTUAL.has(primitive) ? sql`(${value}) COLLATE "C"` : value;

// The driver returns a `numeric` as text and a `date` in the date style of the session:
// both leave the statement in the form the result gives them in.
const OUTPUT: Readonly<Partial<Record<QueryPrimitive, Shaping>>> = {
  number: (value) => sql`(${value})::float8`,
  date: (value) => sql`to_char(${value}, 'YYYY-MM-DD')`,
};

export const outputValue = ({ primitive }: QueryField, value: SQL): SQL =>
  (OUTPUT[primitive] ?? identity)(value);
