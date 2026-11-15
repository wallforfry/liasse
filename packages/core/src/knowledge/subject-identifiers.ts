import {
  MIN_LICENSE_PLATE_LENGTH,
  type SubjectIdentifierType,
  type SubjectKind,
} from '@liasse/contract/domain';
import { z } from 'zod';
import { isValidCardNumber } from '../entities/card-number.ts';
import { findSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import { isValidIban } from '../entities/iban.ts';
import {
  compactSensitive,
  type IdentifierKey,
  maskEnding,
  maskSensitiveIdentifier,
  SENSITIVE_IDENTIFIER_TYPES,
  type SensitiveIdentifierType,
} from '../entities/sensitive.ts';
import { addressKey } from './address.ts';

const CONTRACT_NUMBER = 'contract_number' satisfies SubjectIdentifierType;

// The key of the entity that issued a contract number, inside `subjects.identifiers`.
// `entities/references.ts` rewrites it when that entity is merged.
export const ISSUER_ID_KEY = 'issuer_id';

const PLAIN_TYPES = [
  'license_plate',
  'vin',
  'address',
] as const satisfies readonly SubjectIdentifierType[];

// An identifier as `subjects.identifiers` holds it. An IBAN or a card number has no value:
// its last characters and its keyed hash, as on an entity. A contract number is only
// unique for the entity that issued it, which it carries when the document says.
const storedSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(PLAIN_TYPES), value: z.string().min(1) }),
  z.strictObject({
    type: z.literal(CONTRACT_NUMBER),
    value: z.string().min(1),
    [ISSUER_ID_KEY]: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.enum(SENSITIVE_IDENTIFIER_TYPES),
    last4: z.string(),
    hash: z.string().min(1),
  }),
]);
export type SubjectIdentifier = z.output<typeof storedSchema>;

// The column is a JSON object, empty by default.
const columnSchema = z.strictObject({ items: z.array(storedSchema).readonly().default([]) });

export const parseSubjectIdentifiers = (column: unknown): readonly SubjectIdentifier[] =>
  columnSchema.parse(column).items;

export const toSubjectIdentifiersColumn = (identifiers: readonly SubjectIdentifier[]) => ({
  items: identifiers,
});

// Case, spaces and separators say nothing about which plate or number it is. Letters and
// digits of every script are kept: a plate is not always written in Latin letters.
const compact = (value: string): string =>
  value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const hasDigit = (value: string): boolean => /\p{Nd}/u.test(value);

// In characters, not in UTF-16 units: a letter outside the basic plane counts once.
export const lengthOf = (value: string): number => Array.from(value).length;

// ISO 3779: seventeen characters, without I, O and Q.
const VIN = /^(?=.*\d)(?=.*[A-Z])[A-HJ-NPR-Z0-9]{17}$/;

const MAX_LICENSE_PLATE_LENGTH = 12;
const MIN_CONTRACT_NUMBER_LENGTH = 3;

// A value too short for what it claims to be, or without a digit, is a fragment: it is
// neither stored nor matched.
const vehicleIdentifier = (value: string): readonly SubjectIdentifier[] => {
  if (VIN.test(value)) return [{ type: 'vin', value }];
  const isPlate =
    lengthOf(value) >= MIN_LICENSE_PLATE_LENGTH &&
    lengthOf(value) <= MAX_LICENSE_PLATE_LENGTH &&
    hasDigit(value);
  return isPlate ? [{ type: 'license_plate', value }] : [];
};

const numberIdentifier = (
  value: string,
  issuerId: string | undefined,
): readonly SubjectIdentifier[] => {
  if (lengthOf(value) < MIN_CONTRACT_NUMBER_LENGTH || !hasDigit(value)) return [];
  return [
    issuerId === undefined
      ? { type: CONTRACT_NUMBER, value }
      : { type: CONTRACT_NUMBER, value, [ISSUER_ID_KEY]: issuerId },
  ];
};

const addressIdentifier = (written: string): readonly SubjectIdentifier[] => {
  const key = addressKey(written);
  return key === '' ? [] : [{ type: 'address', value: key }];
};

type Reader = (written: string, issuerId: string | undefined) => readonly SubjectIdentifier[];

const NUMBER: Reader = (written, issuerId) => numberIdentifier(compact(written), issuerId);

// A dependent is a person: nothing a document prints identifies one here.
const BY_KIND: Readonly<Record<SubjectKind, Reader>> = {
  vehicle: (written) => vehicleIdentifier(compact(written)),
  property: addressIdentifier,
  contract: NUMBER,
  employment: NUMBER,
  account: NUMBER,
  dependent: () => [],
};

interface Sensitive {
  readonly type: SensitiveIdentifierType;
  readonly value: string;
}

// The whole value first, whatever separates its groups, then an IBAN or a card number
// written among other words ("IBAN FR76 ...").
const sensitiveIn = (written: string): Sensitive | undefined => {
  if (isValidIban(compactSensitive('iban', written))) return { type: 'iban', value: written };
  if (/^[\d\s./-]+$/.test(written) && isValidCardNumber(compactSensitive('card_number', written))) {
    return { type: 'card_number', value: written };
  }
  return findSensitiveIdentifiers(written)[0];
};

/**
 * The identifier of a candidate subject as it is stored: none when the value is a
 * fragment. What the value is decides before the kind does: an IBAN or a card number is
 * masked whatever subject it is given for, so neither reaches the column in clear. A
 * contract, job or account number carries the entity that issued the document.
 */
export const storeSubjectIdentifier = (
  key: IdentifierKey,
  kind: SubjectKind,
  written: string | undefined,
  issuerId?: string,
): readonly SubjectIdentifier[] => {
  if (written === undefined) return [];
  const sensitive = sensitiveIn(written);
  if (sensitive === undefined) return BY_KIND[kind](written, issuerId);
  const { last4, hash } = maskSensitiveIdentifier(key, sensitive.type, sensitive.value);
  return [{ type: sensitive.type, last4, hash }];
};

// The identifiers of a mention once the issuer of its document is known: the contract
// numbers of the document are those of its issuer.
export const scopedToIssuer = (
  identifiers: readonly SubjectIdentifier[],
  issuerId: string | undefined,
): readonly SubjectIdentifier[] =>
  issuerId === undefined
    ? identifiers
    : identifiers.map((identifier) =>
        identifier.type === CONTRACT_NUMBER
          ? { ...identifier, [ISSUER_ID_KEY]: issuerId }
          : identifier,
      );

// Two stored identifiers with the same identity are the same identifier. A contract
// number of one issuer is not the same number as that of another.
export const subjectIdentifierIdentity = (identifier: SubjectIdentifier): string => {
  if ('hash' in identifier) return `${identifier.type}:${identifier.hash}`;
  return identifier.type === CONTRACT_NUMBER
    ? `${identifier.type}:${identifier[ISSUER_ID_KEY] ?? ''}:${identifier.value}`
    : `${identifier.type}:${identifier.value}`;
};

// True when the identifier is the value as someone writes it: a plate with or without
// its dashes, an address in any spelling the key brings together. Never true for an IBAN
// or a card number, which only their hash can match.
export const isWrittenAs = (identifier: SubjectIdentifier, written: string): boolean => {
  if ('hash' in identifier) return false;
  return (
    identifier.value === (identifier.type === 'address' ? addressKey(written) : compact(written))
  );
};

export interface SubjectIdentifierView {
  readonly type: SubjectIdentifierType;
  // Masked for an IBAN or a card number.
  readonly value: string;
}

// What a reader of the subject gets: the hash and the issuer stay inside.
export const viewSubjectIdentifier = (identifier: SubjectIdentifier): SubjectIdentifierView =>
  'hash' in identifier
    ? { type: identifier.type, value: maskEnding(identifier.last4) }
    : { type: identifier.type, value: identifier.value };
