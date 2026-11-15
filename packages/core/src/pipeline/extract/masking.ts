import { isPlainRecord } from '@liasse/contract/registry';
import type { MaskSensitive } from '../deps.ts';

/** Masks every string at any depth; keys and other values are left as they are. */
export const maskDeep =
  (mask: MaskSensitive) =>
  (value: unknown): unknown => {
    if (typeof value === 'string') return mask(value);
    if (Array.isArray(value)) return value.map(maskDeep(mask));
    if (!isPlainRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, maskDeep(mask)(inner)]),
    );
  };

const QUOTE_KEY = 'quote';

// In a provenance entry only the quote comes from the document. An entity id or a model
// name is an identifier of the installation: a detector that took a run of its
// characters for an account number would turn it into another, unknown, identifier.
export const maskQuotes =
  (mask: MaskSensitive) =>
  (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(maskQuotes(mask));
    if (!isPlainRecord(entry)) return entry;
    return Object.fromEntries(
      Object.entries(entry).map(([key, inner]) => [
        key,
        key === QUOTE_KEY && typeof inner === 'string' ? mask(inner) : maskQuotes(mask)(inner),
      ]),
    );
  };

// A card number is all digits and fits in a number. A number has no masked form that
// would still be a number, so a value that holds one is not kept at all.
const holdsSensitiveNumber = (mask: MaskSensitive, value: unknown): boolean => {
  if (typeof value === 'number') return mask(String(value)) !== String(value);
  if (Array.isArray(value)) return value.some((inner) => holdsSensitiveNumber(mask, inner));
  return (
    isPlainRecord(value) && Object.values(value).some((inner) => holdsSensitiveNumber(mask, inner))
  );
};

export interface MaskedValues {
  readonly values: Readonly<Record<string, unknown>>;
  /** Names of the values that were dropped. */
  readonly dropped: readonly string[];
}

/**
 * Spec, Privacy: a sensitive identifier is stored masked wherever a value holds it; its
 * full form stays in the text of the document only.
 */
export const maskValues = (
  mask: MaskSensitive,
  values: Readonly<Record<string, unknown>>,
): MaskedValues => {
  const entries = Object.entries(values);
  const kept = entries.filter(([, value]) => !holdsSensitiveNumber(mask, value));
  return {
    values: Object.fromEntries(kept.map(([name, value]) => [name, maskDeep(mask)(value)])),
    dropped: entries.filter(([, value]) => holdsSensitiveNumber(mask, value)).map(([name]) => name),
  };
};
