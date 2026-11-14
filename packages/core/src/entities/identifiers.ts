import { z } from 'zod';
import type { EntityIdentifierType } from '../domain/enums.ts';
import {
  MAX_IDENTIFIER_FORMAT_LENGTH,
  MAX_IDENTIFIER_VALUE_LENGTH,
  MIN_COMPANY_ID_LENGTH,
  MIN_EXTENDABLE_COMPANY_ID_LENGTH,
  MIN_VAT_NUMBER_LENGTH,
  MIN_ATTACHING_CUSTOMER_NUMBER_LENGTH,
} from '../domain/limits.ts';
import { entityIdentifierTypeSchema } from '../domain/schemas.ts';
import { isValidCardNumber } from './card-number.ts';
import { isValidIban } from './iban.ts';
import {
  compactSensitive,
  type IdentifierKey,
  isSensitiveIdentifierType,
  maskEnding,
  maskSensitiveIdentifier,
  SENSITIVE_IDENTIFIER_TYPES,
  type SensitiveIdentifierType,
} from './sensitive.ts';

const OTHER = 'other';

const typedSchema = entityIdentifierTypeSchema.exclude([OTHER]);
const clearTypeSchema = typedSchema.exclude(SENSITIVE_IDENTIFIER_TYPES);
const rawValueSchema = z.string().min(1).max(MAX_IDENTIFIER_VALUE_LENGTH);
const formatSchema = z.string().trim().min(1).max(MAX_IDENTIFIER_FORMAT_LENGTH);

// An identifier as extraction reads it next to an entity, in clear and as written.
export const mentionIdentifierSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: typedSchema, value: rawValueSchema }),
  z.strictObject({ type: z.literal(OTHER), format: formatSchema, value: rawValueSchema }),
]);
export type MentionIdentifier = z.output<typeof mentionIdentifierSchema>;

// An identifier as `entities.identifiers` holds it. A sensitive one has no value.
const storedIdentifierSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: clearTypeSchema, value: z.string().min(1) }),
  z.strictObject({
    type: z.enum(SENSITIVE_IDENTIFIER_TYPES),
    last4: z.string(),
    hash: z.string().min(1),
  }),
  z.strictObject({ type: z.literal(OTHER), format: z.string().min(1), value: z.string().min(1) }),
]);
export type StoredIdentifier = z.output<typeof storedIdentifierSchema>;

// The column is a JSON object, empty by default.
const identifiersColumnSchema = z.strictObject({
  items: z.array(storedIdentifierSchema).readonly().default([]),
});

export const parseIdentifiersColumn = (column: unknown): readonly StoredIdentifier[] =>
  identifiersColumnSchema.parse(column).items;

export const toIdentifiersColumn = (identifiers: readonly StoredIdentifier[]) => ({
  items: identifiers,
});

const alphanumeric = (value: string): string =>
  value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

// Whitespace, case and separators say nothing about which identifier it is.
const NORMALIZERS: Readonly<Record<EntityIdentifierType, (value: string) => string>> = {
  company_id: alphanumeric,
  vat_number: alphanumeric,
  customer_number: alphanumeric,
  iban: (value) => compactSensitive('iban', value),
  card_number: (value) => compactSensitive('card_number', value),
  other: alphanumeric,
};

// A model may label an IBAN or a card number as something else: what the value is
// decides, so neither reaches the column in clear under another type.
const sensitiveTypeOf = ({
  type,
  value,
}: MentionIdentifier): SensitiveIdentifierType | undefined => {
  if (isSensitiveIdentifierType(type)) return type;
  if (isValidIban(compactSensitive('iban', value))) return 'iban';
  return isValidCardNumber(alphanumeric(value)) ? 'card_number' : undefined;
};

const MIN_LENGTHS: Readonly<Partial<Record<EntityIdentifierType, number>>> = {
  company_id: MIN_COMPANY_ID_LENGTH,
  vat_number: MIN_VAT_NUMBER_LENGTH,
};

export type IdentifierRejection = 'empty' | 'malformed';

// Why an identifier read in a document is not kept: it has no letter or digit, or it is
// too short for its type or has no digit, as a company id and a VAT number always have.
// Such a fragment is neither stored nor matched.
export const rejectionOf = (identifier: MentionIdentifier): IdentifierRejection | undefined => {
  const sensitive = sensitiveTypeOf(identifier);
  const value = NORMALIZERS[sensitive ?? identifier.type](identifier.value);
  if (value === '') return 'empty';
  const minimum = MIN_LENGTHS[identifier.type];
  return minimum !== undefined && (value.length < minimum || !/\d/.test(value))
    ? 'malformed'
    : undefined;
};

export const storeIdentifier = (
  key: IdentifierKey,
  identifier: MentionIdentifier,
): readonly StoredIdentifier[] => {
  if (rejectionOf(identifier) !== undefined) return [];
  const sensitive = sensitiveTypeOf(identifier);
  const value = NORMALIZERS[sensitive ?? identifier.type](identifier.value);
  if (sensitive !== undefined) {
    const { last4, hash } = maskSensitiveIdentifier(key, sensitive, value);
    return [{ type: sensitive, last4, hash }];
  }
  return identifier.type === OTHER
    ? [{ type: OTHER, format: identifier.format.toUpperCase(), value }]
    : [{ type: clearTypeSchema.parse(identifier.type), value }];
};

// Two stored identifiers with the same identity are the same identifier.
export const identifierIdentity = (identifier: StoredIdentifier): string => {
  if (identifier.type === OTHER) return `${OTHER}:${identifier.format}:${identifier.value}`;
  return 'hash' in identifier
    ? `${identifier.type}:${identifier.hash}`
    : `${identifier.type}:${identifier.value}`;
};

const CUSTOMER_NUMBER = 'customer_number';

// An identifier that names one entity whoever wrote it: a company id, a VAT number, an
// IBAN, a card number. A customer number is scoped to the entity that issued it, and one
// of a free format says nothing of what it identifies: neither is global.
export const isGlobalIdentifier = (identifier: StoredIdentifier): boolean =>
  identifier.type !== OTHER && identifier.type !== CUSTOMER_NUMBER;

// The types of which an entity has one value. An entity may hold several IBANs or cards,
// so those say nothing here.
const UNIQUE_TYPES: readonly string[] = ['company_id', 'vat_number'];

// An establishment carries the id of its company followed by its own number (a French
// SIRET starts with the SIREN): the two are one company. That holds for a company id
// that is a whole one, never for a VAT number.
const isSameValue = (type: string, left: string, right: string): boolean => {
  if (left === right) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  return (
    type === 'company_id' &&
    shorter.length >= MIN_EXTENDABLE_COMPANY_ID_LENGTH &&
    longer.startsWith(shorter)
  );
};

// True when both lists hold a value of one unique type and no value of one list is the
// value of the other: the two cannot describe the same entity.
export const haveConflictingIdentifiers = (
  left: readonly StoredIdentifier[],
  right: readonly StoredIdentifier[],
): boolean =>
  UNIQUE_TYPES.some((type) => {
    const valuesOf = (identifiers: readonly StoredIdentifier[]): readonly string[] =>
      identifiers.flatMap((identifier) =>
        identifier.type === type && 'value' in identifier ? [identifier.value] : [],
      );
    const [ours, theirs] = [valuesOf(left), valuesOf(right)];
    return (
      ours.length > 0 &&
      theirs.length > 0 &&
      !ours.some((value) => theirs.some((other) => isSameValue(type, value, other)))
    );
  });

// A customer number long enough to designate an entity, as long as one entity carries it.
export const isAttachingCustomerNumber = (identifier: StoredIdentifier): boolean =>
  identifier.type === CUSTOMER_NUMBER &&
  identifier.value.length >= MIN_ATTACHING_CUSTOMER_NUMBER_LENGTH;

export const mergeIdentifiers = (
  known: readonly StoredIdentifier[],
  added: readonly StoredIdentifier[],
): readonly StoredIdentifier[] => [
  ...new Map(
    [...known, ...added].map((identifier) => [identifierIdentity(identifier), identifier]),
  ).values(),
];

export const sharedGlobalIdentifiers = (
  left: readonly StoredIdentifier[],
  right: readonly StoredIdentifier[],
): readonly StoredIdentifier[] => {
  const identities = new Set(right.filter(isGlobalIdentifier).map(identifierIdentity));
  return left.filter(
    (identifier) =>
      isGlobalIdentifier(identifier) && identities.has(identifierIdentity(identifier)),
  );
};

export interface IdentifierView {
  readonly type: EntityIdentifierType;
  // Masked for a sensitive identifier.
  readonly value: string;
  readonly format?: string;
}

// What a reader of the entity gets: the hash stays inside.
export const viewIdentifier = (identifier: StoredIdentifier): IdentifierView => {
  if (identifier.type === OTHER) return identifier;
  return 'hash' in identifier
    ? { type: identifier.type, value: maskEnding(identifier.last4) }
    : identifier;
};
