import { isDeepStrictEqual } from 'node:util';
import { KEY_DATES_FIELD, ownValue } from '@liasse/contract/registry';
import {
  entityProvenanceSchema,
  MANUAL_PROVENANCE,
  manualEntityProvenanceSchema,
} from '../../domain/provenance.ts';
import type { PipelineDocument } from '../document.ts';
import type { CorrectionError, Planned } from './plan.ts';

type Values = Readonly<Record<string, unknown>>;

/**
 * What a person vouches for: each name with the value they were shown, as the API
 * returned it. Values are stored masked, so the value shown is the value stored, and a
 * confirmation that still matches it writes nothing over it.
 */
export type Confirmations = Values;

interface ConfirmRequest {
  readonly confirm: Confirmations;
  /** The names the same request sets or clears, in `core` and in `fields`. */
  readonly corrected: readonly string[];
  /** The core values and fields of the document, as read. */
  readonly values: Values;
}

const KEY_DATES_REFUSED: CorrectionError = {
  code: 'unsupported_field',
  field: KEY_DATES_FIELD,
  message: `"${KEY_DATES_FIELD}" cannot be corrected or confirmed through this operation.`,
};

const valuesOf = (document: PipelineDocument): Values => ({
  ...document.core,
  ...document.fields,
});

export const valueChanged = (names: readonly string[]): CorrectionError => ({
  code: 'value_changed',
  message:
    `The value of ${names.map((name) => `"${name}"`).join(', ')} is no longer the one ` +
    'confirmed: the document changed since it was read. Read it again, then review it.',
});

const confirmError = (
  field: string,
  shown: unknown,
  { corrected, values }: ConfirmRequest,
): readonly CorrectionError[] => {
  if (field === KEY_DATES_FIELD) return [KEY_DATES_REFUSED];
  if (corrected.includes(field)) {
    return [
      {
        code: 'invalid_input',
        field,
        message: `"${field}" is both confirmed and corrected: confirm its value or give it another one, not both.`,
      },
    ];
  }
  const names = Object.keys(values);
  const stored = ownValue(values, field);
  if (stored === undefined) {
    return [
      {
        code: 'unknown_field',
        field,
        message:
          names.length === 0
            ? `There is no value "${field}" to confirm: the document has no value.`
            : `There is no value "${field}" to confirm. The values of the document are: ${names.join(', ')}.`,
      },
    ];
  }
  return isDeepStrictEqual(stored, shown) ? [] : [{ ...valueChanged([field]), field }];
};

/** The values a person vouches for, each one the document holds as it was shown. */
export const planConfirm = (
  confirm: Confirmations,
  corrected: readonly string[],
  document: PipelineDocument,
): Planned<Confirmations> => {
  const request = { confirm, corrected, values: valuesOf(document) };
  const errors = Object.entries(confirm).flatMap(([name, shown]) =>
    confirmError(name, shown, request),
  );
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: confirm };
};

/** The confirmed names whose value is not, or no longer, the one the person was shown. */
export const changedConfirmations = (
  stored: PipelineDocument,
  confirm: Confirmations,
): readonly string[] => {
  const values = valuesOf(stored);
  return Object.entries(confirm).flatMap(([name, shown]) => {
    const value = ownValue(values, name);
    return value !== undefined && isDeepStrictEqual(value, shown) ? [] : [name];
  });
};

// A confirmed value is not rewritten: its entry only gains the mark of a person, and an
// entity name keeps the entity it was resolved to.
const confirmedItem = (entry: unknown): unknown => {
  if (manualEntityProvenanceSchema.safeParse(entry).success) return entry;
  const entity = entityProvenanceSchema.safeParse(entry);
  return entity.success ? { ...entity.data, ...MANUAL_PROVENANCE } : MANUAL_PROVENANCE;
};

const confirmedEntry = (value: unknown, entry: unknown): unknown =>
  Array.isArray(value)
    ? value.map((_, index) => confirmedItem(Array.isArray(entry) ? entry[index] : undefined))
    : confirmedItem(entry);

/** The provenance entries of the confirmed values, marked manual. */
export const confirmedEntries = (stored: PipelineDocument, confirm: Confirmations): Values =>
  Object.fromEntries(
    Object.entries(confirm).map(([name, value]) => [
      name,
      confirmedEntry(value, ownValue(stored.provenance, name)),
    ]),
  );
