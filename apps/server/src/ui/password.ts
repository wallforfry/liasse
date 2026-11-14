import { createHash, timingSafeEqual } from 'node:crypto';
import type { Argon2idHash, UiPassword } from '@liasse/core/config';
import { argon2id } from 'hash-wasm';

/** `busy` when the check was not made: too many hashes are being computed already. */
export type PasswordVerdict = 'match' | 'mismatch' | 'busy';

export type PasswordCheck = (presented: string) => Promise<PasswordVerdict>;

export type Argon2idHasher = (presented: string, expected: Argon2idHash) => Promise<Uint8Array>;

// Every attempt holds the memory of its hash (up to 64 MiB) and queues behind the others
// on the event loop; past this many, an attempt is answered at once without hashing.
export const MAX_HASHES_IN_FLIGHT = 2;

export interface PasswordCheckOptions {
  readonly maxInFlight?: number;
  /** hash-wasm by default; a test holds the computation open. */
  readonly hash?: Argon2idHasher;
}

const digest = (value: string | Uint8Array): Buffer => createHash('sha256').update(value).digest();

/** Equal or not, in a time that depends on neither value: both sides are hashed first. */
export const sameSecret = (left: string | Uint8Array, right: string | Uint8Array): boolean =>
  timingSafeEqual(digest(left), digest(right));

const verdictOf = (matches: boolean): PasswordVerdict => (matches ? 'match' : 'mismatch');

const hashWithWasm: Argon2idHasher = (presented, expected) =>
  argon2id({
    password: presented,
    salt: expected.salt,
    memorySize: expected.memorySize,
    iterations: expected.iterations,
    parallelism: expected.parallelism,
    hashLength: expected.hash.length,
    outputType: 'binary',
  });

/**
 * Checks a password against `UI_PASSWORD`. A plain value costs nothing to compare; an
 * argon2id hash is computed at most `maxInFlight` times at once, whatever the number of
 * clients, so the login limit per client is not the only bound on that work.
 */
export const createPasswordCheck = (
  password: UiPassword,
  { maxInFlight = MAX_HASHES_IN_FLIGHT, hash = hashWithWasm }: PasswordCheckOptions = {},
): PasswordCheck => {
  if (password.kind === 'plain') {
    return (presented) => Promise.resolve(verdictOf(sameSecret(presented, password.value)));
  }
  let inFlight = 0;
  return async (presented) => {
    if (inFlight >= maxInFlight) return 'busy';
    inFlight += 1;
    try {
      return verdictOf(sameSecret(await hash(presented, password), password.hash));
    } finally {
      inFlight -= 1;
    }
  };
};
