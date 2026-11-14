import { z } from 'zod';
import type { SubjectIdentifierType, SubjectKind } from '../domain/enums.ts';
import {
  MIN_ATTACHING_CONTRACT_NUMBER_LENGTH,
  MIN_LICENSE_PLATE_LENGTH,
} from '../domain/limits.ts';
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
import { addressKey, isCompleteAddress } from './address.ts';

const CLEAR_TYPES = [
  'license_plate',
  'vin',
  'contract_number',
  'address',
] as const satisfies readonly SubjectIdentifierType[];
type ClearType = (typeof CLEAR_TYPES)[number];

// An identifier as `subjects.identifiers` holds it. An IBAN or a card number has no value:
// its last characters and its keyed hash, as on an entity.
const storedSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.enum(CLEAR_TYPES), value: z.string().min(1) }),
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
const lengthOf = (value: string): number => Array.from(value).length;

// ISO 3779: seventeen characters, without I, O and Q.
const VIN = /^(?=.*\d)(?=.*[A-Z])[A-HJ-NPR-Z0-9]{17}$/;

const MAX_LICENSE_PLATE_LENGTH = 12;
const MIN_CONTRACT_NUMBER_LENGTH = 3;

const clear = (type: ClearType, value: string): readonly SubjectIdentifier[] => [{ type, value }];

// A value too short for what it claims to be, or without a digit, is a fragment: it is
// neither stored nor matched.
const vehicleIdentifier = (value: string): readonly SubjectIdentifier[] => {
  if (VIN.test(value)) return clear('vin', value);
  const isPlate =
    lengthOf(value) >= MIN_LICENSE_PLATE_LENGTH &&
    lengthOf(value) <= MAX_LICENSE_PLATE_LENGTH &&
    hasDigit(value);
  return isPlate ? clear('license_plate', value) : [];
};

const numberIdentifier = (value: string): readonly SubjectIdentifier[] =>
  lengthOf(value) >= MIN_CONTRACT_NUMBER_LENGTH && hasDigit(value)
    ? clear('contract_number', value)
    : [];

const addressIdentifier = (written: string): readonly SubjectIdentifier[] => {
  const key = addressKey(written);
  return key === '' ? [] : clear('address', key);
};

// A dependent is a person: nothing a document prints identifies one here.
const BY_KIND: Readonly<Record<SubjectKind, (written: string) => readonly SubjectIdentifier[]>> = {
  vehicle: (written) => vehicleIdentifier(compact(written)),
  property: addressIdentifier,
  contract: (written) => numberIdentifier(compact(written)),
  employment: (written) => numberIdentifier(compact(written)),
  account: (written) => numberIdentifier(compact(written)),
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
 * masked whatever subject it is given for, so neither reaches the column in clear.
 */
export const storeSubjectIdentifier = (
  key: IdentifierKey,
  kind: SubjectKind,
  written: string | undefined,
): readonly SubjectIdentifier[] => {
  if (written === undefined) return [];
  const sensitive = sensitiveIn(written);
  if (sensitive === undefined) return BY_KIND[kind](written);
  const { last4, hash } = maskSensitiveIdentifier(key, sensitive.type, sensitive.value);
  return [{ type: sensitive.type, last4, hash }];
};

// Two stored identifiers with the same identity are the same identifier.
export const subjectIdentifierIdentity = (identifier: SubjectIdentifier): string =>
  'hash' in identifier
    ? `${identifier.type}:${identifier.hash}`
    : `${identifier.type}:${identifier.value}`;

const GLOBAL_TYPES: readonly SubjectIdentifierType[] = [
  'license_plate',
  'vin',
  'iban',
  'card_number',
];

// An identifier that names one subject whoever wrote it. A contract number is scoped to
// its issuer and an address to its precision: neither is global.
export const isGlobalSubjectIdentifier = ({ type }: SubjectIdentifier): boolean =>
  GLOBAL_TYPES.includes(type);

// An identifier that can say on its own which subject a document is about, as long as one
// subject carries it: a global one, a contract number long enough, an address in full.
export const isAttachingSubjectIdentifier = (identifier: SubjectIdentifier): boolean => {
  if (identifier.type === 'contract_number') {
    return lengthOf(identifier.value) >= MIN_ATTACHING_CONTRACT_NUMBER_LENGTH;
  }
  return identifier.type === 'address'
    ? isCompleteAddress(identifier.value)
    : isGlobalSubjectIdentifier(identifier);
};

// An address that is not whole is not a different address: it may be the same place,
// written short.
const tellsApart = (identifier: SubjectIdentifier): boolean =>
  identifier.type !== 'address' || isCompleteAddress(identifier.value);

// True when both lists hold a value of one type and share none: two plates, two contract
// numbers, two full addresses. The two cannot describe the same subject for sure.
export const haveConflictingSubjectIdentifiers = (
  left: readonly SubjectIdentifier[],
  right: readonly SubjectIdentifier[],
): boolean => {
  const [ours, theirs] = [left.filter(tellsApart), right.filter(tellsApart)];
  return [...new Set(ours.map(({ type }) => type))].some((type) => {
    const others = theirs.filter((identifier) => identifier.type === type);
    const identities = new Set(others.map(subjectIdentifierIdentity));
    return (
      others.length > 0 &&
      !ours.some(
        (identifier) =>
          identifier.type === type && identities.has(subjectIdentifierIdentity(identifier)),
      )
    );
  });
};

export const mergeSubjectIdentifiers = (
  known: readonly SubjectIdentifier[],
  added: readonly SubjectIdentifier[],
): readonly SubjectIdentifier[] => [
  ...new Map(
    [...known, ...added].map((identifier) => [subjectIdentifierIdentity(identifier), identifier]),
  ).values(),
];

export const sharedGlobalSubjectIdentifiers = (
  left: readonly SubjectIdentifier[],
  right: readonly SubjectIdentifier[],
): readonly SubjectIdentifier[] => {
  const identities = new Set(
    right.filter(isGlobalSubjectIdentifier).map(subjectIdentifierIdentity),
  );
  return left.filter(
    (identifier) =>
      isGlobalSubjectIdentifier(identifier) &&
      identities.has(subjectIdentifierIdentity(identifier)),
  );
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

// What a reader of the subject gets: the hash stays inside.
export const viewSubjectIdentifier = (identifier: SubjectIdentifier): SubjectIdentifierView =>
  'hash' in identifier
    ? { type: identifier.type, value: maskEnding(identifier.last4) }
    : { type: identifier.type, value: identifier.value };
