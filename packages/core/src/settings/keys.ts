import type { Settings } from '@liasse/contract';
import type { SecretState } from '@liasse/contract/domain';

/** The sections of the settings that hold a key. */
export const SECRET_SLOTS = ['llm', 'embedding', 'hindsight', 'google'] as const;
export type SecretSlot = (typeof SECRET_SLOTS)[number];

/** The field of its section that holds the key of each slot. */
export const KEY_FIELDS: Readonly<Record<SecretSlot, string>> = {
  llm: 'api_key',
  embedding: 'api_key',
  hindsight: 'api_key',
  google: 'client_secret',
};

/** A stored key: its value once decrypted, absent, or sealed under another AUTH_SECRET. */
export type StoredKey =
  | { readonly state: 'set'; readonly value: string }
  | { readonly state: 'unset' }
  | { readonly state: 'unreadable' };

export type StoredKeys = Readonly<Record<SecretSlot, StoredKey>>;

const UNSET: StoredKey = { state: 'unset' };

export const NO_KEYS: StoredKeys = {
  llm: UNSET,
  embedding: UNSET,
  hindsight: UNSET,
  google: UNSET,
};

const keyOf = (value: string | undefined): StoredKey =>
  value === undefined ? UNSET : { state: 'set', value };

/** The keys of settings whose keys are all known. */
export const keysOf = (settings: Settings): StoredKeys => ({
  llm: keyOf(settings.llm.api_key),
  embedding: keyOf(settings.embedding.api_key),
  hindsight: keyOf(settings.hindsight.api_key),
  google: keyOf(settings.google.client_secret),
});

export const stateOfKey = ({ state }: StoredKey): SecretState => state;

export const unreadableSlots = (keys: StoredKeys): readonly SecretSlot[] =>
  SECRET_SLOTS.filter((slot) => keys[slot].state === 'unreadable');
