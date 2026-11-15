import { MAX_QUERY_IN_VALUES, MAX_QUERY_STRING_LENGTH } from '@liasse/contract/domain';
import {
  failure,
  notAllowed,
  type Operator,
  type QueryDsl,
  type QueryError,
  type QueryLocation,
  quoted,
} from '@liasse/contract/query';
import { err, ok, type Result } from '@liasse/contract/registry';
import { capabilitiesOf } from './capabilities.ts';
import { collect } from './collect.ts';
import type { QueryField } from './fields.ts';
import { findField, partsHint } from './find-field.ts';

export const ORDERING_OPERATORS = ['<', '<=', '>', '>='] as const;
export type OrderingOperator = (typeof ORDERING_OPERATORS)[number];

export type CheckedCondition =
  // `=`, `!=` and `in`. The values of an entity field are names or ids of entities.
  | {
      readonly kind: 'equals';
      readonly field: QueryField;
      readonly values: readonly unknown[];
      readonly negated: boolean;
      readonly at: QueryLocation;
    }
  | {
      readonly kind: 'ordering';
      readonly field: QueryField;
      readonly operator: OrderingOperator;
      readonly value: unknown;
    }
  | { readonly kind: 'substring'; readonly field: QueryField; readonly text: string }
  // The item looked for in a list of entities is a name or an id of entity, like above.
  | {
      readonly kind: 'member';
      readonly field: QueryField;
      readonly item: unknown;
      readonly at: QueryLocation;
    }
  | { readonly kind: 'exists'; readonly field: QueryField; readonly expected: boolean };

type Checked<Value> = Result<Value, readonly QueryError[]>;

const invalidLiteral = (at: QueryLocation, message: string): Checked<never> =>
  err([failure('invalid_literal', at, message)]);

const isTooLong = (raw: unknown): boolean =>
  typeof raw === 'string' && raw.length > MAX_QUERY_STRING_LENGTH;

const tooLong = (at: QueryLocation): Checked<never> =>
  invalidLiteral(at, `A text value has at most ${String(MAX_QUERY_STRING_LENGTH)} characters.`);

const literal = (field: QueryField, raw: unknown, at: QueryLocation): Checked<unknown> => {
  if (isTooLong(raw)) return tooLong(at);
  const checked = field.check(raw);
  if (checked.ok) return checked;
  const kind = field.items === undefined ? field.primitive : `list of ${field.items}`;
  const { reason, allowed } = checked.error;
  return err([
    {
      ...failure(
        'invalid_literal',
        at,
        `${quoted(raw)} does not compare with ${field.path} (${kind}): ${reason}.`,
      ),
      ...(allowed === undefined ? {} : { allowed }),
    },
  ]);
};

const equals =
  (negated: boolean) =>
  (field: QueryField, raw: unknown, at: QueryLocation): Checked<CheckedCondition> => {
    const value = literal(field, raw, at);
    return value.ok ? ok({ kind: 'equals', field, values: [value.value], negated, at }) : value;
  };

const oneOf = (field: QueryField, raw: unknown, at: QueryLocation): Checked<CheckedCondition> => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUERY_IN_VALUES) {
    return invalidLiteral(at, `"in" takes an array of 1 to ${String(MAX_QUERY_IN_VALUES)} values.`);
  }
  const values = collect(raw.map((item: unknown, index) => literal(field, item, [...at, index])));
  return values.ok
    ? ok({ kind: 'equals', field, values: values.value, negated: false, at })
    : values;
};

const ordering =
  (operator: OrderingOperator) =>
  (field: QueryField, raw: unknown, at: QueryLocation): Checked<CheckedCondition> => {
    const value = literal(field, raw, at);
    return value.ok ? ok({ kind: 'ordering', field, operator, value: value.value }) : value;
  };

const contains = (
  field: QueryField,
  raw: unknown,
  at: QueryLocation,
): Checked<CheckedCondition> => {
  if (field.primitive === 'list') {
    const item = literal(field, raw, at);
    return item.ok ? ok({ kind: 'member', field, item: item.value, at }) : item;
  }
  if (isTooLong(raw)) return tooLong(at);
  return typeof raw === 'string' && raw !== ''
    ? ok({ kind: 'substring', field, text: raw })
    : invalidLiteral(at, `"contains" on ${field.path} takes a non-empty text.`);
};

const exists = (field: QueryField, raw: unknown, at: QueryLocation): Checked<CheckedCondition> =>
  typeof raw === 'boolean'
    ? ok({ kind: 'exists', field, expected: raw })
    : invalidLiteral(at, '"exists" takes true or false.');

type Check = (field: QueryField, raw: unknown, at: QueryLocation) => Checked<CheckedCondition>;

const CHECKS: Readonly<Record<Operator, Check>> = {
  '=': equals(false),
  '!=': equals(true),
  '<': ordering('<'),
  '<=': ordering('<='),
  '>': ordering('>'),
  '>=': ordering('>='),
  in: oneOf,
  contains,
  exists,
};

const FIELD = 0;
const OPERATOR = 1;
const VALUE = 2;

const checkCondition =
  (fields: readonly QueryField[]) =>
  ([path, operator, raw]: QueryDsl['where'][number], index: number): Checked<CheckedCondition> => {
    const field = findField(fields, path, ['where', index, FIELD]);
    if (!field.ok) return field;
    const { operators } = capabilitiesOf(field.value.primitive);
    if (!operators.includes(operator)) {
      return err([
        notAllowed(
          'unsupported_operator',
          ['where', index, OPERATOR],
          `"${operator}" does not apply to ${path} (${field.value.primitive}). Its operators: ${operators.join(', ')}.${partsHint(field.value)}`,
          operators,
        ),
      ]);
    }
    return CHECKS[operator](field.value, raw, ['where', index, VALUE]);
  };

export const checkConditions = (
  where: QueryDsl['where'],
  fields: readonly QueryField[],
): Checked<readonly CheckedCondition[]> => collect(where.map(checkCondition(fields)));
