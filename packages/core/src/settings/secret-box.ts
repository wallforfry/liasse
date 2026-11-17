import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { StartupError } from '../domain/errors.ts';

const KEY_LABEL = 'liasse settings secrets v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

/** Encrypts the keys of the settings at rest. */
export interface SecretBox {
  /** `slot` names what the value is the key of: a sealed value opens in its own slot only. */
  readonly seal: (slot: string, plaintext: string) => string;
  /** Throws `SettingsSecretError` when the value was sealed under another key or slot. */
  readonly open: (slot: string, sealed: string) => string;
}

export class SettingsSecretError extends StartupError {
  override readonly name = 'SettingsSecretError';
  constructor(options?: ErrorOptions) {
    super(
      'A key of the stored settings cannot be decrypted: AUTH_SECRET changed since it was ' +
        'saved, or the row was altered. Restore AUTH_SECRET, or save the keys again.',
      options,
    );
  }
}

const encode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
const decode = (text: string): Buffer => Buffer.from(text, 'base64url');

/**
 * AES-256-GCM under a key derived by HKDF from `AUTH_SECRET`, with a label of its own, so
 * the keys share no key material with the sessions signed with that secret. The slot is
 * the additional data: a value copied into another slot of the row does not open.
 */
export const createSecretBox = (authSecret: string): SecretBox => {
  if (authSecret === '') throw new Error('The settings secrets need a secret');
  const key = new Uint8Array(
    hkdfSync('sha256', authSecret, new Uint8Array(), KEY_LABEL, KEY_LENGTH),
  );
  return {
    seal: (slot, plaintext) => {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(Buffer.from(slot, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, encode(iv), encode(cipher.getAuthTag()), encode(ciphertext)].join('.');
    },
    open: (slot, sealed) => {
      const [version, iv, tag, ciphertext, ...rest] = sealed.split('.');
      if (
        version !== VERSION ||
        iv === undefined ||
        tag === undefined ||
        ciphertext === undefined ||
        rest.length > 0
      ) {
        throw new SettingsSecretError();
      }
      try {
        const decipher = createDecipheriv(ALGORITHM, key, decode(iv), {
          authTagLength: TAG_LENGTH,
        });
        decipher.setAAD(Buffer.from(slot, 'utf8'));
        decipher.setAuthTag(decode(tag));
        return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString(
          'utf8',
        );
      } catch (error) {
        throw new SettingsSecretError({ cause: error });
      }
    },
  };
};
