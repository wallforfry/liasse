import type { SQL } from 'drizzle-orm';
import { entityIdProvenancePath } from '../domain/provenance.ts';
import { moneySchema, periodSchema } from '../domain/values.ts';
import { type FieldPath, fieldPaths } from '../registry/field-paths.ts';
import type { TypeFields } from '../registry/fields.ts';
import type { QueryPrimitive } from './capabilities.ts';
import { DOCUMENT_COLUMNS } from './document-columns.ts';
import {
  checkByDefinition,
  checkBySchema,
  type LiteralCheck,
  nothingCompares,
} from './literal-check.ts';

const JSON_COLUMNS = ['core', 'fields'] as const;
export type JsonColumn = (typeof JSON_COLUMNS)[number];

export type FieldSource =
  | { readonly kind: 'column'; readonly expression: SQL }
  | { readonly kind: 'json'; readonly column: JsonColumn; readonly keys: readonly string[] };

export interface QueryField {
  readonly path: string;
  readonly primitive: QueryPrimitive;
  readonly source: FieldSource;
  // Checks a value compared with the field or, for a list, with one of its items.
  readonly check: LiteralCheck;
  // The primitive of the items, for a list.
  readonly items?: QueryPrimitive;
  // The parts a query addresses instead of the whole: `value` and `currency` of an amount.
  readonly parts: readonly string[];
  // For the value of an amount, the path of its currency.
  readonly currency?: string;
  // For an entity, where `documents.provenance` holds the id it was resolved to. The
  // field itself holds the name as extracted: it says whether the document names an
  // entity, and the id says which one.
  readonly identity?: readonly string[];
}

interface Part {
  readonly primitive: QueryPrimitive;
  readonly check: LiteralCheck;
  // The sibling part that holds the currency of this one.
  readonly currency?: string;
}

// The parts of the structured primitives, typed by the schemas that validate them.
const PARTS: Readonly<Partial<Record<QueryPrimitive, Readonly<Record<string, Part>>>>> = {
  money: {
    value: {
      primitive: 'number',
      check: checkBySchema(moneySchema.shape.value),
      currency: 'currency',
    },
    currency: { primitive: 'text', check: checkBySchema(moneySchema.shape.currency) },
  },
  period: {
    start: { primitive: 'date', check: checkBySchema(periodSchema.shape.start) },
    end: { primitive: 'date', check: checkBySchema(periodSchema.shape.end) },
  },
};

const isJsonColumn = (name: string | undefined): name is JsonColumn =>
  JSON_COLUMNS.some((column) => column === name);

const partsOf = (whole: QueryField, column: JsonColumn, name: string): readonly QueryField[] =>
  Object.entries(PARTS[whole.primitive] ?? {}).map(([part, { primitive, check, currency }]) => ({
    path: `${whole.path}.${part}`,
    primitive,
    source: { kind: 'json', column, keys: [name, part] },
    check,
    parts: [],
    ...(currency === undefined ? {} : { currency: `${whole.path}.${currency}` }),
  }));

const typing = (
  entry: FieldPath,
  name: string,
): Pick<QueryField, 'check' | 'items' | 'identity'> => {
  if (!('definition' in entry)) return { check: nothingCompares };
  const { definition } = entry;
  if (definition.type === 'list') {
    return { check: checkByDefinition(definition.items), items: definition.items.type };
  }
  return {
    check: checkByDefinition(definition),
    ...(definition.type === 'entity' ? { identity: entityIdProvenancePath(name) } : {}),
  };
};

const jsonFields = (entry: FieldPath): readonly QueryField[] => {
  const [column, name] = entry.path.split('.');
  if (!isJsonColumn(column) || name === undefined) {
    throw new Error(`The registry addresses "${entry.path}", which is not under core or fields`);
  }
  const whole: QueryField = {
    path: entry.path,
    primitive: entry.primitive,
    source: { kind: 'json', column, keys: [name] },
    parts: Object.keys(PARTS[entry.primitive] ?? {}),
    ...typing(entry, name),
  };
  return [whole, ...partsOf(whole, column, name)];
};

const columnFields: readonly QueryField[] = Object.entries(DOCUMENT_COLUMNS).map(
  ([path, { definition, expression }]) => ({
    path,
    primitive: definition.type,
    source: { kind: 'column', expression },
    check: checkByDefinition(definition),
    parts: [],
  }),
);

// Everything a query may address: the document columns, the common core and, with a
// type, its own fields. Nothing outside this list ever reaches a statement.
export const queryFields = (type?: { readonly fields: TypeFields }): readonly QueryField[] => [
  ...columnFields,
  ...fieldPaths(type ?? { fields: {} }).flatMap(jsonFields),
];
