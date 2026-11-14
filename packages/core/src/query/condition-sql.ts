import { type SQL, sql } from 'drizzle-orm';
import { PROVENANCE_ENTITY_ID_KEY } from '../domain/provenance.ts';
import {
  fieldIdentity,
  fieldParameter,
  fieldValue,
  itemProvenance,
  textParameters,
} from './access.ts';
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

// A text that folds to nothing, such as a lone combining accent, is found in no value:
// `strpos` would find the empty text at the start of every one.
const substring = (field: QueryField, text: string): SQL => {
  const needle = sql`unaccent(lower(${text}::text))`;
  return sql`(${needle} <> '' AND strpos(unaccent(lower(${fieldValue(field)})), ${needle}) > 0)`;
};

// An item of a list of entities is found through the provenance of the list, which holds
// the entity each item was resolved to; the items themselves are names as extracted.
const resolvedMember = (provenanceKey: string, ids: readonly string[]): SQL =>
  ids.length === 0
    ? sql`FALSE`
    : sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${itemProvenance(provenanceKey)}) AS "item"
        WHERE "item" ->> ${PROVENANCE_ENTITY_ID_KEY}::text IN (${textParameters(ids)}))`;

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
      return substring(field, condition.text);
    case 'member':
      return field.itemIdentities === undefined
        ? sql`${fieldValue(field)} @> ${JSON.stringify([condition.item])}::jsonb`
        : resolvedMember(field.itemIdentities, idsOf([condition.item], entityIds));
    case 'exists':
      return condition.expected
        ? sql`${fieldValue(field)} IS NOT NULL`
        : sql`${fieldValue(field)} IS NULL`;
  }
};
