import {
  CORE_FIELD_NAMES,
  CORE_FIELDS,
  type FieldDefinition,
  KEY_DATES_FIELD,
  ownValue,
} from '@liasse/contract/registry';
import { z } from 'zod';
import type { TypeFields } from '../../registry/fields.ts';
import { manualKeyDatesSchema } from '../../knowledge/manual-key-dates.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import { coreValueSchema } from '../../registry/values.ts';

/**
 * `update_document`: a value sets a field, `null` clears it, an absent key leaves it. A
 * name in `confirm`, with the value the person was shown, keeps that value as it is.
 */
export const correctionInputSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1).optional(),
  core: z.record(z.string(), z.unknown()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  confirm: z.record(z.string().min(1), z.unknown()).optional(),
  private: z.boolean().optional(),
});
export type CorrectionInput = z.input<typeof correctionInputSchema>;
export type CorrectionRequest = Readonly<z.output<typeof correctionInputSchema>>;

export const CORRECTION_ERROR_CODES = [
  'invalid_input',
  'document_not_found',
  'type_not_found',
  'no_type',
  'unknown_field',
  'unsupported_field',
  'invalid_value',
  'unresolved_entity',
  'value_changed',
] as const;

export interface CorrectionError {
  readonly code: (typeof CORRECTION_ERROR_CODES)[number];
  /** Complete on its own: it is shown as is to the agent that made the request. */
  readonly message: string;
  readonly field?: string;
}

export interface SectionPatch {
  readonly set: Readonly<Record<string, unknown>>;
  readonly clear: readonly string[];
  /** Names of the entity-typed values set, each with the names it holds. */
  readonly entityNames: Readonly<Record<string, readonly string[]>>;
}

export type Planned<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly errors: readonly CorrectionError[] };

type Definitions = Readonly<Record<string, FieldDefinition>>;

const stringsOf = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((item: unknown) =>
    typeof item === 'string' ? [item] : [],
  );

const entityNamesOf = (
  set: Readonly<Record<string, unknown>>,
  definitions: Definitions,
): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    Object.entries(set).flatMap(([name, value]) => {
      const definition = ownValue(definitions, name);
      const entity =
        definition?.type === 'entity' ||
        (definition?.type === 'list' && definition.items.type === 'entity');
      return entity ? [[name, stringsOf(value)] as const] : [];
    }),
  );

const split = (patch: Readonly<Record<string, unknown>>) => ({
  set: Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)),
  clear: Object.entries(patch).flatMap(([name, value]) => (value === null ? [name] : [])),
});

const unknownFields = (names: readonly string[], known: readonly string[]) =>
  names
    .filter((name) => !known.includes(name))
    .map((field): CorrectionError => ({
      code: 'unknown_field',
      field,
      message: `There is no field "${field}" to clear. The fields are: ${known.join(', ')}.`,
    }));

const invalidValues = (
  issues: readonly z.core.$ZodIssue[],
  prefix: readonly PropertyKey[],
): readonly CorrectionError[] =>
  issues.map(({ path, message }): CorrectionError => {
    const field = [...prefix, ...path].map(String).join('.');
    return {
      code: 'invalid_value',
      message: `core${field === '' ? '' : `.${field}`}: ${message}`,
      ...(field === '' ? {} : { field }),
    };
  });

// Key dates are also rows of `document_dates`: they are held to the bounds of those rows
// here, so that the correction writes the same dates to both.
const parseKeyDates = (set: Readonly<Record<string, unknown>>) => {
  const keyDates = ownValue(set, KEY_DATES_FIELD);
  return keyDates === undefined ? undefined : manualKeyDatesSchema.safeParse(keyDates);
};

export const planCore = (patch: Readonly<Record<string, unknown>>): Planned<SectionPatch> => {
  const { set, clear } = split(patch);
  const parsed = coreValueSchema().safeParse(set);
  const keyDates = parseKeyDates(set);
  const errors: readonly CorrectionError[] = [
    ...unknownFields(clear, CORE_FIELD_NAMES),
    ...(parsed.success ? [] : invalidValues(parsed.error.issues, [])),
    ...(parsed.success && keyDates?.success === false
      ? invalidValues(keyDates.error.issues, [KEY_DATES_FIELD])
      : []),
  ];
  if (errors.length > 0 || !parsed.success) return { ok: false, errors };
  const values =
    keyDates?.success === true ? { ...parsed.data, [KEY_DATES_FIELD]: keyDates.data } : parsed.data;
  return { ok: true, value: { set: values, clear, entityNames: entityNamesOf(set, CORE_FIELDS) } };
};

export const planFields = (
  patch: Readonly<Record<string, unknown>>,
  fields: TypeFields,
): Planned<SectionPatch> => {
  const { set, clear } = split(patch);
  const validated = validateDocumentFields({ fields }, set);
  const errors: readonly CorrectionError[] = [
    ...unknownFields(clear, Object.keys(fields)),
    ...(validated.ok
      ? []
      : validated.error.map(({ code, field, path, message }): CorrectionError => ({
          code,
          message: code === 'unknown_field' ? message : `fields.${path}: ${message}`,
          ...(field === undefined ? {} : { field }),
        }))),
  ];
  return errors.length > 0 || !validated.ok
    ? { ok: false, errors }
    : { ok: true, value: { set: validated.value, clear, entityNames: entityNamesOf(set, fields) } };
};

export const EMPTY_PATCH: SectionPatch = { set: {}, clear: [], entityNames: {} };
