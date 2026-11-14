import { z } from 'zod';
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_CONDITIONS,
  MAX_QUERY_GROUP_BY,
  MAX_QUERY_LIMIT,
  MAX_QUERY_SELECT,
  MAX_QUERY_STRING_LENGTH,
} from '../domain/limits.ts';
import { err, ok, type Result } from '../registry/result.ts';
import { failure, type QueryError, quoted } from './errors.ts';

export const OPERATORS = ['=', '!=', '<', '<=', '>', '>=', 'in', 'contains', 'exists'] as const;
export type Operator = (typeof OPERATORS)[number];

export const AGGREGATE_FUNCTIONS = ['count', 'sum', 'min', 'max', 'avg'] as const;
export type AggregateFunction = (typeof AGGREGATE_FUNCTIONS)[number];

export const ORDER_DIRECTIONS = ['asc', 'desc'] as const;
export type OrderDirection = (typeof ORDER_DIRECTIONS)[number];

// The target of `count` that counts documents instead of the values of a field.
export const COUNT_ALL = '*';

const oneOf = <const Values extends readonly [string, ...string[]]>(noun: string, values: Values) =>
  z.enum(values, {
    error: (issue) =>
      `Unknown ${noun} ${quoted(issue.input)}. Expected one of: ${values.join(', ')}.`,
  });

const fieldPath = z.string().min(1).max(MAX_QUERY_STRING_LENGTH);

const condition = z
  .tuple([fieldPath, oneOf('operator', OPERATORS), z.unknown()])
  .describe('[field path, operator, value]');

const hasOneKey = (record: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(record).length > 0;

const aggregate = z
  .partialRecord(z.enum(AGGREGATE_FUNCTIONS), fieldPath)
  .refine(hasOneKey, `expected at least one of: ${AGGREGATE_FUNCTIONS.join(', ')}`)
  .describe(
    `Each function with the field path it applies to; {"count": "${COUNT_ALL}"} counts documents.`,
  );

// The one definition of the DSL. No transform, so that it renders to JSON Schema as is.
export const queryDslSchema = z.strictObject({
  type: z
    .string()
    .min(1)
    .max(MAX_QUERY_STRING_LENGTH)
    .optional()
    .describe('Slug or alias of a type. Without it, only core and document fields exist.'),
  where: z.array(condition).max(MAX_QUERY_CONDITIONS).default([]),
  select: z
    .array(fieldPath)
    .max(MAX_QUERY_SELECT)
    .optional()
    .describe('Fields returned with each row, on top of id, type, title and core.'),
  order_by: z.tuple([fieldPath, oneOf('direction', ORDER_DIRECTIONS)]).optional(),
  aggregate: aggregate.optional(),
  group_by: z.array(fieldPath).min(1).max(MAX_QUERY_GROUP_BY).optional(),
  limit: z.int().min(1).max(MAX_QUERY_LIMIT).default(DEFAULT_QUERY_LIMIT),
  offset: z.int().min(0).default(0),
  include_private: z.boolean().default(false),
});

export type QueryDsl = z.output<typeof queryDslSchema>;

// What an agent is shown: the defaults are optional on the way in.
export const queryDslJsonSchema = () => z.toJSONSchema(queryDslSchema, { io: 'input' });

const MAX_REPORTED_ISSUES = 20;

const allowedKeys = (path: readonly PropertyKey[]): readonly string[] =>
  path[0] === 'aggregate' ? AGGREGATE_FUNCTIONS : Object.keys(queryDslSchema.shape);

const describeIssue = (issue: z.core.$ZodIssue): string =>
  issue.code === 'unrecognized_keys'
    ? `Unknown ${issue.keys.length === 1 ? 'key' : 'keys'} ${issue.keys.map(quoted).join(', ')}. Expected: ${allowedKeys(issue.path).join(', ')}.`
    : issue.message;

const location = (path: readonly PropertyKey[]): readonly (string | number)[] =>
  path.map((key) => (typeof key === 'number' ? key : String(key)));

// Zod goes on checking a value whose type is already wrong, and then reports the length
// of a text against the bound of a list. The first issue of a place is the one that helps.
const firstByPlace = (issues: readonly z.core.$ZodIssue[]): readonly z.core.$ZodIssue[] => {
  const places = issues.map(({ path }) => JSON.stringify(location(path)));
  return issues.filter((_, index) => places.indexOf(places[index] ?? '') === index);
};

export const parseQueryDsl = (input: unknown): Result<QueryDsl, readonly QueryError[]> => {
  const parsed = queryDslSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err(
        firstByPlace(parsed.error.issues)
          .slice(0, MAX_REPORTED_ISSUES)
          .map((issue) => failure('invalid_query', location(issue.path), describeIssue(issue))),
      );
};
