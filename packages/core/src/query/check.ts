import type { QueryDsl, QueryError, QueryWarning } from '@liasse/contract/query';
import { err, ok, type Result } from '@liasse/contract/registry';
import { type CheckedCondition, checkConditions } from './check-conditions.ts';
import {
  type AggregateShape,
  checkAggregates,
  type CheckedShape,
  checkRows,
  type RowsShape,
} from './check-shape.ts';
import type { QueryField } from './fields.ts';

// A query whose every path, operator, aggregate and value was checked against the fields
// it may address. The compiler takes nothing else.
export interface CheckedQuery {
  readonly conditions: readonly CheckedCondition[];
  readonly shape: RowsShape | AggregateShape;
  readonly limit: number;
  readonly offset: number;
  readonly includePrivate: boolean;
  readonly warnings: readonly QueryWarning[];
}

export const checkQuery = (
  dsl: QueryDsl,
  fields: readonly QueryField[],
): Result<CheckedQuery, readonly QueryError[]> => {
  const conditions = checkConditions(dsl.where, fields);
  const checked: Result<
    CheckedShape<RowsShape | AggregateShape>,
    readonly QueryError[]
  > = dsl.aggregate === undefined
    ? checkRows(dsl, fields)
    : checkAggregates(dsl, dsl.aggregate, fields);
  if (!conditions.ok || !checked.ok) {
    return err([conditions, checked].flatMap((part) => (part.ok ? [] : part.error)));
  }
  return ok({
    conditions: conditions.value,
    shape: checked.value.shape,
    limit: dsl.limit,
    offset: dsl.offset,
    includePrivate: dsl.include_private,
    warnings: checked.value.warnings,
  });
};
