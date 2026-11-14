import { createHash, timingSafeEqual } from 'node:crypto';
import type { Argon2idHash, UiPassword } from '@liasse/core/config';
import { argon2id } from 'hash-wasm';

export type PasswordCheck = (presented: string) => Promise<boolean>;

const digest = (value: string | Uint8Array): Buffer => createHash('sha256').update(value).digest();

/** Equal or not, in a time that depends on neither value: both sides are hashed first. */
export const sameSecret = (left: string | Uint8Array, right: string | Uint8Array): boolean =>
  timingSafeEqual(digest(left), digest(right));

const argon2idOf = async (presented: string, expected: Argon2idHash): Promise<Uint8Array> =>
  argon2id({
    password: presented,
    salt: expected.salt,
    memorySize: expected.memorySize,
    iterations: expected.iterations,
    parallelism: expected.parallelism,
    hashLength: expected.hash.length,
    outputType: 'binary',
  });

/** Checks a password against `UI_PASSWORD`, a plain value or an argon2id hash. */
export const createPasswordCheck = (password: UiPassword): PasswordCheck =>
  password.kind === 'plain'
    ? (presented) => Promise.resolve(sameSecret(presented, password.value))
    : async (presented) => sameSecret(await argon2idOf(presented, password), password.hash);
