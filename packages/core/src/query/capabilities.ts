import type { AggregateFunction, Operator } from '@liasse/contract/query';
import type { FieldPrimitive } from '@liasse/contract/registry';
import type { KEY_DATES_FIELD } from '../registry/core-fields.ts';

export type QueryPrimitive = FieldPrimitive | typeof KEY_DATES_FIELD;

export interface Capabilities {
  readonly operators: readonly Operator[];
  readonly aggregates: readonly AggregateFunction[];
  readonly sortable: boolean;
  readonly groupable: boolean;
}

// A value with parts, or several values: it is there or not, and nothing compares to it.
const OPAQUE: Capabilities = {
  operators: ['exists'],
  aggregates: ['count'],
  sortable: false,
  groupable: false,
};

const LABEL: Capabilities = {
  operators: ['=', '!=', 'in', 'exists'],
  aggregates: ['count'],
  sortable: true,
  groupable: true,
};

const SEARCHABLE_LABEL: Capabilities = {
  ...LABEL,
  operators: ['=', '!=', 'in', 'contains', 'exists'],
};

const ORDERED_OPERATORS = ['=', '!=', '<', '<=', '>', '>=', 'in', 'exists'] as const;

// What a query may do with a value of each primitive. Keyed by the primitive table of the
// registry, so a primitive added there does not compile until it is decided here.
export const CAPABILITIES = {
  text: SEARCHABLE_LABEL,
  identifier: SEARCHABLE_LABEL,
  enum: LABEL,
  boolean: { ...LABEL, operators: ['=', '!=', 'exists'] },
  number: {
    ...LABEL,
    operators: ORDERED_OPERATORS,
    aggregates: ['count', 'sum', 'min', 'max', 'avg'],
  },
  date: { ...LABEL, operators: ORDERED_OPERATORS, aggregates: ['count', 'min', 'max'] },
  // Entities are compared by id: their order means nothing.
  entity: { ...LABEL, sortable: false },
  money: OPAQUE,
  period: OPAQUE,
  list: { ...OPAQUE, operators: ['contains', 'exists'] },
  key_dates: OPAQUE,
} as const satisfies Readonly<Record<QueryPrimitive, Capabilities>>;

export const capabilitiesOf = (primitive: QueryPrimitive): Capabilities => CAPABILITIES[primitive];
