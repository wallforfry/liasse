import { isoDateSchema } from '@liasse/contract/domain';
import {
  type FieldDefinition,
  isPlainRecord,
  ownValue,
  type ScalarFieldDefinition,
} from '@liasse/contract/registry';
import { CORE_FIELDS, KEY_DATES_FIELD } from '../../registry/core-fields.ts';
import type { TypeFields } from '../../registry/fields.ts';
import type { SupportKind } from './support.ts';

/** How the quote of each value of a section is read: by its field, or by its shape. */
export type KindOf = (field: string, value: unknown) => SupportKind;

const SCALAR_KINDS: Readonly<Record<ScalarFieldDefinition['type'], SupportKind>> = {
  text: 'text',
  entity: 'text',
  identifier: 'identifier',
  enum: 'enum',
  number: 'number',
  money: 'money',
  date: 'date',
  period: 'period',
  boolean: 'unchecked',
};

const kindOfDefinition = (definition: FieldDefinition): SupportKind =>
  definition.type === 'list' ? SCALAR_KINDS[definition.items.type] : SCALAR_KINDS[definition.type];

// The language of a document is read from the whole of it: no quote states it.
const LANGUAGE_FIELD = 'language';

export const coreKinds: KindOf = (field) => {
  if (field === KEY_DATES_FIELD) return 'key_date';
  if (field === LANGUAGE_FIELD) return 'unchecked';
  const definition = ownValue<FieldDefinition>(CORE_FIELDS, field);
  return definition === undefined ? 'text' : kindOfDefinition(definition);
};

// A value the type does not define has no kind: it was validated against the untyped
// primitives, and is read by what it looks like.
export const kindOfShape: KindOf = (_field, value) => {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'unchecked';
  if (typeof value === 'string') return isoDateSchema.safeParse(value).success ? 'date' : 'text';
  if (isPlainRecord(value) && 'currency' in value) return 'money';
  return isPlainRecord(value) && 'start' in value ? 'period' : 'text';
};

export const typeKinds =
  (fields: TypeFields): KindOf =>
  (field, value) => {
    const definition = ownValue(fields, field);
    return definition === undefined ? kindOfShape(field, value) : kindOfDefinition(definition);
  };
