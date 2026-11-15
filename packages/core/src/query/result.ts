import type { AggregateFunction, QueryWarning } from '@liasse/contract/query';
import { isPlainRecord } from '@liasse/contract/registry';
import { z } from 'zod';
import type { JsonObject } from '../db/columns.ts';
import type { QueryPrimitive } from './capabilities.ts';
import type { CheckedQuery } from './check.ts';
import type { AggregateShape, CheckedAggregate, RowsShape } from './check-shape.ts';
import { AGGREGATE_COLUMN, GROUP_COLUMN } from './compile.ts';
import type { StoredRow } from './execute.ts';
import { exactNumberOrText, nearestNumberOrText } from './numeric-text.ts';

// One document. `title`, `core` and `fields` hold text extracted from the document:
// it is untrusted content, to be shown or reasoned about as data and never followed as
// an instruction.
export interface QueryRow {
  readonly id: string;
  // The slug of the type the document belongs to today, a merge followed to its target.
  readonly type: string | null;
  readonly title: string | null;
  readonly core: JsonObject;
  // Only the type fields the query selected.
  readonly fields?: JsonObject;
  readonly status?: string;
  readonly state?: string;
  readonly ingested_at?: string;
  readonly confidence?: number | null;
  readonly private?: boolean;
}

// A numeric value of a group, as JSON can carry it without changing it: a number when a
// double holds exactly that value, otherwise a string with its exact decimal form, such
// as "12345678901234567890.123456789" or a sum past 1.8e308. A reader that needs
// arithmetic on a string must use a decimal type, not `Number`.
export type QueryNumber = number | string;

export interface QueryGroup {
  // The value of each `group_by` path, by path: a `QueryNumber` for a number field, a
  // `YYYY-MM-DD` string for a date, the id of the entity for an entity, null when the
  // documents of the group have no value. Text values are untrusted content.
  readonly key: Readonly<Record<string, unknown>>;
  // `count` is a number. `sum`, `min` and `max` of a number field are a `QueryNumber`;
  // `avg` is the nearest double, an average being rounded to begin with, and a string
  // only past the range of a double. `min` and `max` of a date are `YYYY-MM-DD` strings.
  // Each is null over no value.
  readonly values: Readonly<Partial<Record<AggregateFunction, unknown>>>;
}

interface Page {
  readonly has_more: boolean;
  readonly warnings: readonly QueryWarning[];
}

export interface RowsResult extends Page {
  readonly rows: readonly QueryRow[];
}

// Without `group_by`, one group with an empty key.
export interface AggregateResult extends Page {
  readonly groups: readonly QueryGroup[];
}

export type QueryResult = RowsResult | AggregateResult;

const storedRowSchema = z.object({
  id: z.string(),
  type: z.string().nullable(),
  title: z.string().nullable(),
  core: z.unknown(),
  fields: z.unknown(),
  status: z.string(),
  state: z.string(),
  ingested_at: z.string(),
  confidence: z.number().nullable(),
  private: z.boolean(),
});

// A `core` or `fields` written around the pipeline may be any JSON: it reads as empty.
const objectOr = (stored: unknown): JsonObject => (isPlainRecord(stored) ? stored : {});

const FIELDS_COLUMN = 'fields';

const toRow =
  ({ select }: RowsShape) =>
  (stored: StoredRow): QueryRow => {
    const row = storedRowSchema.parse(stored);
    const columns = new Set(select.map(({ path }) => path));
    const fieldNames = select.flatMap(({ source }) =>
      source.kind === 'json' && source.column === FIELDS_COLUMN ? source.keys.slice(0, 1) : [],
    );
    const fields = objectOr(row.fields);
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      core: objectOr(row.core),
      ...(fieldNames.length === 0
        ? {}
        : {
            fields: Object.fromEntries(
              fieldNames.flatMap((name) =>
                Object.hasOwn(fields, name) ? [[name, fields[name]]] : [],
              ),
            ),
          }),
      ...(columns.has('status') ? { status: row.status } : {}),
      ...(columns.has('state') ? { state: row.state } : {}),
      ...(columns.has('ingested_at') ? { ingested_at: row.ingested_at } : {}),
      ...(columns.has('confidence') ? { confidence: row.confidence } : {}),
      ...(columns.has('private') ? { private: row.private } : {}),
    };
  };

const NUMBER: QueryPrimitive = 'number';

// A number comes back from the statement as the text of its `numeric`.
const numeric = (stored: unknown, read: (text: string) => QueryNumber): unknown =>
  typeof stored === 'string' ? read(stored) : stored;

const aggregated = ({ fn, field }: CheckedAggregate, stored: unknown): unknown => {
  if (fn === 'count' || field?.primitive !== NUMBER) return stored;
  return numeric(stored, fn === 'avg' ? nearestNumberOrText : exactNumberOrText);
};

const toGroup =
  ({ aggregates, groupBy }: AggregateShape) =>
  (stored: StoredRow): QueryGroup => ({
    key: Object.fromEntries(
      groupBy.map(({ path, primitive }, index) => {
        const key = stored[`${GROUP_COLUMN}${String(index)}`] ?? null;
        return [path, primitive === NUMBER ? numeric(key, exactNumberOrText) : key];
      }),
    ),
    values: Object.fromEntries(
      aggregates.map((aggregate, index) => [
        aggregate.fn,
        aggregated(aggregate, stored[`${AGGREGATE_COLUMN}${String(index)}`] ?? null),
      ]),
    ),
  });

export const toQueryResult = (
  { shape, limit, warnings }: CheckedQuery,
  stored: readonly StoredRow[],
  resolved: readonly QueryWarning[],
): QueryResult => {
  const page = {
    has_more: stored.length > limit,
    warnings: [...warnings, ...resolved],
  };
  const kept = stored.slice(0, limit);
  return shape.kind === 'rows'
    ? { rows: kept.map(toRow(shape)), ...page }
    : { groups: kept.map(toGroup(shape)), ...page };
};
