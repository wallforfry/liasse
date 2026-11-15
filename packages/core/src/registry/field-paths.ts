import type { FieldDefinition, FieldPrimitive } from '@liasse/contract/registry';
import { CORE_FIELDS, KEY_DATES_FIELD } from './core-fields.ts';
import type { TypeFields } from './fields.ts';

export type FieldPath =
  | {
      readonly path: string;
      readonly primitive: FieldPrimitive;
      readonly definition: FieldDefinition;
    }
  // Key dates are objects with a kind, a date and a label: no primitive describes them.
  | { readonly path: string; readonly primitive: typeof KEY_DATES_FIELD };

const pathsUnder = (prefix: string, fields: TypeFields): readonly FieldPath[] =>
  Object.entries(fields).map(([name, definition]) => ({
    path: `${prefix}.${name}`,
    primitive: definition.type,
    definition,
  }));

// What a query may address in a document of this type: the common core, then its own fields.
export const fieldPaths = (type: { readonly fields: TypeFields }): readonly FieldPath[] => [
  ...pathsUnder('core', CORE_FIELDS),
  { path: `core.${KEY_DATES_FIELD}`, primitive: KEY_DATES_FIELD },
  ...pathsUnder('fields', type.fields),
];
