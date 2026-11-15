import {
  MIN_ATTACHING_CONTRACT_NUMBER_LENGTH,
  type SubjectIdentifierType,
} from '@liasse/contract/domain';
import { isCompleteAddress } from './address.ts';
import {
  ISSUER_ID_KEY,
  lengthOf,
  type SubjectIdentifier,
  subjectIdentifierIdentity,
} from './subject-identifiers.ts';

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
// subject carries it: a global one, a contract number long enough of a known issuer, an
// address in full. Two issuers may give the same number, so one without its issuer says
// nothing on its own, as a customer number of an entity.
export const isAttachingSubjectIdentifier = (identifier: SubjectIdentifier): boolean => {
  if (identifier.type === 'contract_number') {
    return (
      identifier[ISSUER_ID_KEY] !== undefined &&
      lengthOf(identifier.value) >= MIN_ATTACHING_CONTRACT_NUMBER_LENGTH
    );
  }
  return identifier.type === 'address'
    ? isCompleteAddress(identifier.value)
    : isGlobalSubjectIdentifier(identifier);
};

// An address that is not whole is not a different address: it may be the same place,
// written short.
const tellsApart = (identifier: SubjectIdentifier): boolean =>
  identifier.type !== 'address' || isCompleteAddress(identifier.value);

// What says two values of one type are one value. The issuer of a contract number is left
// out: a termination letter the holder writes quotes the number of the insurer, and two
// different numbers are two contracts whoever issued them.
const valueOf = (identifier: SubjectIdentifier): string =>
  'hash' in identifier ? identifier.hash : identifier.value;

// True when both lists hold a value of one type and share none: two plates, two contract
// numbers, two full addresses. The two cannot describe the same subject for sure.
export const haveConflictingSubjectIdentifiers = (
  left: readonly SubjectIdentifier[],
  right: readonly SubjectIdentifier[],
): boolean => {
  const [ours, theirs] = [left.filter(tellsApart), right.filter(tellsApart)];
  return [...new Set(ours.map(({ type }) => type))].some((type) => {
    const others = new Set(theirs.filter((item) => item.type === type).map(valueOf));
    return others.size > 0 && !ours.some((item) => item.type === type && others.has(valueOf(item)));
  });
};

// The identifiers known, then those added that are not a value already known: a contract
// number quoted by another document than its issuer's is the same number, and keeps the
// issuer it was first known with.
export const mergeSubjectIdentifiers = (
  known: readonly SubjectIdentifier[],
  added: readonly SubjectIdentifier[],
): readonly SubjectIdentifier[] =>
  [...known, ...added].filter(
    (identifier, index, all) =>
      all.findIndex(
        (other) => other.type === identifier.type && valueOf(other) === valueOf(identifier),
      ) === index,
  );

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
