import { createHmac, hkdfSync } from 'node:crypto';
import type { EntityIdentifierType } from '@liasse/contract/domain';

// The identifiers that are never stored in clear: only their last characters and a keyed
// hash are kept.
export const SENSITIVE_IDENTIFIER_TYPES = [
  'iban',
  'card_number',
] as const satisfies readonly EntityIdentifierType[];
export type SensitiveIdentifierType = (typeof SENSITIVE_IDENTIFIER_TYPES)[number];

export const isSensitiveIdentifierType = (
  type: EntityIdentifierType,
): type is SensitiveIdentifierType => SENSITIVE_IDENTIFIER_TYPES.some((known) => known === type);

const KEY_LABEL = 'liasse.entities.identifier-hash.v1';
const KEY_LENGTH = 32;

export interface IdentifierKey {
  readonly hmacKey: Uint8Array;
}

// The key of the identifier hashes, derived with HKDF from a secret of the installation
// (`auth.fileUrlSecret` of the configuration) under a label of its own, so the hashes
// share no key material with the signatures made with that secret. The space of IBANs
// and card numbers is small enough to enumerate: without the key a stored hash cannot be
// reversed offline. A hash made under another secret no longer matches, so changing the
// secret makes every stored IBAN and card number unknown to resolution until the entity
// meets it again; nothing else is lost.
export const deriveIdentifierKey = (secret: string): IdentifierKey => {
  if (secret === '') throw new Error('The identifier key needs a secret');
  return {
    hmacKey: new Uint8Array(hkdfSync('sha256', secret, new Uint8Array(), KEY_LABEL, KEY_LENGTH)),
  };
};

const LAST_CHARACTERS = 4;
const MASK = '****';

export interface MaskedIdentifier {
  // What may be shown and stored in place of the value.
  readonly masked: string;
  readonly last4: string;
  // HMAC-SHA-256 of the type and the normalized value, in hexadecimal.
  readonly hash: string;
}

export const maskEnding = (last4: string): string => `${MASK}${last4}`;

// Separators and case say nothing about which IBAN or card it is.
export const compactSensitive = (type: SensitiveIdentifierType, value: string): string =>
  type === 'iban' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : value.replace(/\D/g, '');

const lastCharactersOf = (normalized: string): string =>
  normalized.length > LAST_CHARACTERS ? normalized.slice(-LAST_CHARACTERS) : '';

// What stands for the value where it must not be read. It needs no key: only the hash does.
export const maskOf = (type: SensitiveIdentifierType, value: string): string =>
  maskEnding(lastCharactersOf(compactSensitive(type, value)));

// The same value masks to the same result however it is written. A value too short to hide anything shows none of its characters.
export const maskSensitiveIdentifier = (
  key: IdentifierKey,
  type: SensitiveIdentifierType,
  value: string,
): MaskedIdentifier => {
  const normalized = compactSensitive(type, value);
  const last4 = lastCharactersOf(normalized);
  return {
    masked: maskEnding(last4),
    last4,
    hash: createHmac('sha256', key.hmacKey).update(`${type}\n${normalized}`).digest('hex'),
  };
};
