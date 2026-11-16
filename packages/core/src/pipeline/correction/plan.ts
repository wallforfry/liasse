import {
  CORE_FIELD_NAMES,
  CORE_FIELDS,
  type FieldDefinition,
  KEY_DATES_FIELD,
  ownValue,
} from '@liasse/contract/registry';
import { z } from 'zod';
import type { TypeFields } from '../../registry/fields.ts';
import { validateDocumentFields } from '../../registry/validate-document-fields.ts';
import { coreValueSchema } from '../../registry/values.ts';

/**
 * `update_document`: a value sets a field, `null` clears it, an absent key leaves it. A
 * name in `confirm` keeps the value it has, which a person vouches for.
 */
export const correctionInputSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1).optional(),
  core: z.record(z.string(), z.unknown()).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  confirm: z.array(z.string().min(1)).optional(),
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

// Key dates also live in `document_dates`, which the knowledge layer owns: correcting
// them here would leave the two apart.
const KEY_DATES_UNSUPPORTED: CorrectionError = {
  code: 'unsupported_field',
  field: KEY_DATES_FIELD,
  message: `"${KEY_DATES_FIELD}" cannot be corrected or confirmed through this operation.`,
};

export const planCore = (patch: Readonly<Record<string, unknown>>): Planned<SectionPatch> => {
  if (Object.hasOwn(patch, KEY_DATES_FIELD)) return { ok: false, errors: [KEY_DATES_UNSUPPORTED] };
  const { set, clear } = split(patch);
  const parsed = coreValueSchema().safeParse(set);
  const errors: readonly CorrectionError[] = [
    ...unknownFields(clear, CORE_FIELD_NAMES),
    ...(parsed.success
      ? []
      : parsed.error.issues.map(({ path, message }): CorrectionError => {
          const field = path.map(String).join('.');
          return {
            code: 'invalid_value',
            message: `core${field === '' ? '' : `.${field}`}: ${message}`,
            ...(field === '' ? {} : { field }),
          };
        })),
  ];
  return errors.length > 0 || !parsed.success
    ? { ok: false, errors }
    : {
        ok: true,
        value: { set: parsed.data, clear, entityNames: entityNamesOf(set, CORE_FIELDS) },
      };
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

interface ConfirmRequest {
  readonly names: readonly string[];
  /** The names the same request sets or clears, in `core` and in `fields`. */
  readonly corrected: readonly string[];
  /** The names that hold a value in the document, core and fields alike. */
  readonly present: readonly string[];
}

const confirmError = (
  field: string,
  { corrected, present }: ConfirmRequest,
): readonly CorrectionError[] => {
  if (field === KEY_DATES_FIELD) return [KEY_DATES_UNSUPPORTED];
  if (corrected.includes(field)) {
    return [
      {
        code: 'invalid_input',
        field,
        message: `"${field}" is both confirmed and corrected: confirm its value or give it another one, not both.`,
      },
    ];
  }
  return present.includes(field)
    ? []
    : [
        {
          code: 'unknown_field',
          field,
          message:
            present.length === 0
              ? `There is no value "${field}" to confirm: the document has no value.`
              : `There is no value "${field}" to confirm. The values of the document are: ${present.join(', ')}.`,
        },
      ];
};

/** The names a person vouches for, each of a value the document holds as it is. */
export const planConfirm = (request: ConfirmRequest): Planned<readonly string[]> => {
  const names = [...new Set(request.names)];
  const errors = names.flatMap((name) => confirmError(name, request));
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: names };
};
