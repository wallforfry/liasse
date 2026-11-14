import { err, ok, type Result } from '../registry/result.ts';
import { capabilitiesOf } from './capabilities.ts';
import { collect } from './collect.ts';
import {
  AGGREGATE_FUNCTIONS,
  type AggregateFunction,
  COUNT_ALL,
  type OrderDirection,
  type QueryDsl,
} from './dsl.ts';
import { failure, notAllowed, type QueryError, type QueryWarning } from './errors.ts';
import type { QueryField } from './fields.ts';
import { findField, partsHint } from './find-field.ts';

export interface CheckedAggregate {
  readonly fn: AggregateFunction;
  // Absent for a count of documents.
  readonly field?: QueryField;
}

export interface RowsShape {
  readonly kind: 'rows';
  readonly order?: { readonly field: QueryField; readonly direction: OrderDirection };
  readonly select: readonly QueryField[];
}

export interface AggregateShape {
  readonly kind: 'aggregate';
  readonly aggregates: readonly CheckedAggregate[];
  readonly groupBy: readonly QueryField[];
}

export interface CheckedShape<Shape> {
  readonly shape: Shape;
  readonly warnings: readonly QueryWarning[];
}

type Checked<Value> = Result<Value, readonly QueryError[]>;

const checkOrder = (
  orderBy: QueryDsl['order_by'],
  fields: readonly QueryField[],
): Checked<RowsShape['order']> => {
  if (orderBy === undefined) return ok(undefined);
  const [path, direction] = orderBy;
  const field = findField(fields, path, ['order_by', 0]);
  if (!field.ok) return field;
  return capabilitiesOf(field.value.primitive).sortable
    ? ok({ field: field.value, direction })
    : err([
        failure(
          'not_sortable',
          ['order_by', 0],
          `${path} (${field.value.primitive}) has no order.${partsHint(field.value)}`,
        ),
      ]);
};

export const checkRows = (
  dsl: QueryDsl,
  fields: readonly QueryField[],
): Checked<CheckedShape<RowsShape>> => {
  const grouping: Checked<unknown> =
    dsl.group_by === undefined
      ? ok(undefined)
      : err([failure('invalid_query', ['group_by'], '"group_by" needs an "aggregate".')]);
  const order = checkOrder(dsl.order_by, fields);
  const select = collect(
    (dsl.select ?? []).map((path, index) => findField(fields, path, ['select', index])),
  );
  if (!grouping.ok || !order.ok || !select.ok) {
    return err([grouping, order, select].flatMap((part) => (part.ok ? [] : part.error)));
  }
  return ok({
    shape: {
      kind: 'rows',
      select: select.value,
      ...(order.value === undefined ? {} : { order: order.value }),
    },
    warnings: [],
  });
};

const checkAggregate = (
  fn: AggregateFunction,
  target: string,
  fields: readonly QueryField[],
): Checked<CheckedAggregate> => {
  if (fn === 'count' && target === COUNT_ALL) return ok({ fn });
  const field = findField(fields, target, ['aggregate', fn]);
  if (!field.ok) return field;
  const { aggregates } = capabilitiesOf(field.value.primitive);
  return aggregates.includes(fn)
    ? ok({ fn, field: field.value })
    : err([
        notAllowed(
          'unsupported_aggregate',
          ['aggregate', fn],
          `"${fn}" does not apply to ${target} (${field.value.primitive}). Its aggregates: ${aggregates.join(', ')}.${partsHint(field.value)}`,
          aggregates,
        ),
      ]);
};

const checkGroup =
  (fields: readonly QueryField[]) =>
  (path: string, index: number): Checked<QueryField> => {
    const field = findField(fields, path, ['group_by', index]);
    if (!field.ok) return field;
    return capabilitiesOf(field.value.primitive).groupable
      ? field
      : err([
          failure(
            'not_groupable',
            ['group_by', index],
            `${path} (${field.value.primitive}) cannot group documents.${partsHint(field.value)}`,
          ),
        ]);
  };

// Amounts in different currencies do not add up, and a minimum across them means nothing.
// An aggregate over the value of an amount is therefore computed per currency, and the
// answer says so: the agent gets a correct result in one call instead of an error.
const impliedCurrencies = (
  aggregates: readonly CheckedAggregate[],
  groupBy: readonly QueryField[],
  fields: readonly QueryField[],
): readonly QueryField[] => {
  const grouped = new Set(groupBy.map(({ path }) => path));
  const needed = aggregates.flatMap(({ fn, field }) =>
    fn === 'count' || field?.currency === undefined || grouped.has(field.currency)
      ? []
      : [field.currency],
  );
  return [...new Set(needed)].flatMap((path) => fields.filter((field) => field.path === path));
};

const currencyWarning = ({ path }: QueryField): QueryWarning => ({
  code: 'implicit_currency_grouping',
  message: `Amounts in different currencies cannot be aggregated together: the result is also grouped by ${path}.`,
  path: ['group_by'],
});

const ORDER_IGNORED: QueryWarning = {
  code: 'order_by_ignored',
  message: '"order_by" orders rows and has no effect on an aggregate: groups come by their keys.',
  path: ['order_by'],
};

export const checkAggregates = (
  dsl: QueryDsl,
  aggregate: NonNullable<QueryDsl['aggregate']>,
  fields: readonly QueryField[],
): Checked<CheckedShape<AggregateShape>> => {
  const selection: Checked<unknown> =
    dsl.select === undefined
      ? ok(undefined)
      : err([failure('invalid_query', ['select'], '"select" does not apply to an "aggregate".')]);
  const order = checkOrder(dsl.order_by, fields);
  const aggregates = collect(
    AGGREGATE_FUNCTIONS.flatMap((fn) => {
      const target = aggregate[fn];
      return target === undefined ? [] : [checkAggregate(fn, target, fields)];
    }),
  );
  const groupBy = collect((dsl.group_by ?? []).map(checkGroup(fields)));
  if (!selection.ok || !order.ok || !aggregates.ok || !groupBy.ok) {
    return err(
      [selection, order, aggregates, groupBy].flatMap((part) => (part.ok ? [] : part.error)),
    );
  }
  const currencies = impliedCurrencies(aggregates.value, groupBy.value, fields);
  return ok({
    shape: {
      kind: 'aggregate',
      aggregates: aggregates.value,
      groupBy: [...groupBy.value, ...currencies],
    },
    warnings: [
      ...currencies.map(currencyWarning),
      ...(order.value === undefined ? [] : [ORDER_IGNORED]),
    ],
  });
};
