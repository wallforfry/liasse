import { LANGUAGE_CODES } from '../domain/languages.ts';
import type { FieldDefinition } from './primitives.ts';

// The common core is fixed here and nowhere else: no registry operation reads or writes
// it, and its names are reserved so that a type field can never shadow one.
export const CORE_FIELDS = {
  document_date: { type: 'date' },
  issuer: { type: 'entity' },
  recipient: { type: 'entity' },
  amount: { type: 'money' },
  period: { type: 'period' },
  due_date: { type: 'date' },
  reference: { type: 'text' },
  language: { type: 'enum', values: LANGUAGE_CODES },
} as const satisfies Readonly<Record<string, FieldDefinition>>;

export const KEY_DATES_FIELD = 'key_dates';

export const CORE_FIELD_NAMES: readonly string[] = [...Object.keys(CORE_FIELDS), KEY_DATES_FIELD];
