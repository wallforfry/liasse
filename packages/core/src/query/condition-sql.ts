import { type SQL, sql } from 'drizzle-orm';
import { fieldIdentity, fieldParameter, fieldValue } from './access.ts';
import type { CheckedCondition, OrderingOperator } from './check-conditions.ts';
import type { QueryField } from './fields.ts';

// The ids each entity name or id of the query stands for; none when nothing bears it.
export type EntityIds = ReadonlyMap<string, readonly string[]>;

const ORDERING: Readonly<Record<OrderingOperator, SQL>> = {
  '<': sql`<`,
  '<=': sql`<=`,
  '>': sql`>`,
  '>=': sql`>=`,
};

const idsOf = (names: readonly unknown[], entityIds: EntityIds): readonly string[] =>
  names.flatMap((name) => (typeof name === 'string' ? (entityIds.get(name) ?? []) : []));

// A missing value is different from any value: `!=` keeps the documents without the field.
// An entity is compared by the id its name was resolved to, never by the name itself.
const equality = (field: QueryField, values: readonly unknown[], negated: boolean): SQL => {
  if (values.length === 0) return negated ? sql`TRUE` : sql`FALSE`;
  const value = fieldIdentity(field);
  const list = sql.join(
    values.map((candidate) => fieldParameter(field, candidate)),
    sql`, `,
  );
  return negated
    ? sql`(${value} IS NULL OR ${value} NOT IN (${list}))`
    : sql`${value} IN (${list})`;
};

export const conditionSql = (condition: CheckedCondition, entityIds: EntityIds): SQL => {
  const { field } = condition;
  switch (condition.kind) {
    case 'equals':
      return equality(
        field,
        field.identity === undefined ? condition.values : idsOf(condition.values, entityIds),
        condition.negated,
      );
    case 'ordering':
      return sql`${fieldValue(field)} ${ORDERING[condition.operator]} ${fieldParameter(field, condition.value)}`;
    case 'substring':
      return sql`strpos(unaccent(lower(${fieldValue(field)})), unaccent(lower(${condition.text}::text))) > 0`;
    case 'member':
      return sql`${fieldValue(field)} @> ${JSON.stringify([condition.item])}::jsonb`;
    case 'exists':
      return condition.expected
        ? sql`${fieldValue(field)} IS NOT NULL`
        : sql`${fieldValue(field)} IS NULL`;
  }
};
