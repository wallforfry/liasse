import { z } from 'zod';

/** The cost and the output of an argon2id hash, as its PHC string states them. */
export interface Argon2idHash {
  readonly kind: 'argon2id';
  /** In KiB. */
  readonly memorySize: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly salt: Uint8Array;
  readonly hash: Uint8Array;
}

export type UiPassword = { readonly kind: 'plain'; readonly value: string } | Argon2idHash;

// The only version of the algorithm (0x13) the hash libraries compute.
const ARGON2_VERSION = 19;
const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 16;
// The hash is computed on the event loop, so its cost is time every request waits for.
// Memory times passes is bounded at 64 MiB-passes: about 50 ms on an Apple M-series core
// with hash-wasm (the OWASP setting m=19456,t=2 takes 28 ms there), a few times that on a
// small ARM host. Every OWASP argon2id setting (m=47104,t=1 down to m=7168,t=5) fits.
const MAX_MEMORY_KIB = 64 * 1024;
const MAX_ITERATIONS = 16;
const MAX_PARALLELISM = 8;
const MAX_MEMORY_PASSES = 64 * 1024;

const HASH_PREFIX = '$argon2';
const PHC = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const NOT_A_HASH =
  'a value starting with $argon2 must be an argon2id hash in PHC form, ' +
  `$argon2id$v=${String(ARGON2_VERSION)}$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>, ` +
  `with at most ${String(MAX_MEMORY_KIB)} KiB, ${String(MAX_ITERATIONS)} passes, ` +
  `${String(MAX_PARALLELISM)} lanes and ${String(MAX_MEMORY_PASSES)} KiB times passes, ` +
  `a salt of ${String(MIN_SALT_BYTES)} bytes or more ` +
  `and a hash of ${String(MIN_HASH_BYTES)} bytes or more`;

const parseArgon2id = (value: string): Argon2idHash | undefined => {
  const [, version, memory, passes, lanes, salt, hash] = PHC.exec(value) ?? [];
  if (salt === undefined || hash === undefined) return undefined;
  const [memorySize, iterations, parallelism] = [memory, passes, lanes].map(Number);
  const parsed = {
    kind: 'argon2id' as const,
    memorySize: memorySize ?? 0,
    iterations: iterations ?? 0,
    parallelism: parallelism ?? 0,
    salt: new Uint8Array(Buffer.from(salt, 'base64')),
    hash: new Uint8Array(Buffer.from(hash, 'base64')),
  };
  const withinBounds =
    Number(version) === ARGON2_VERSION &&
    parsed.parallelism >= 1 &&
    parsed.parallelism <= MAX_PARALLELISM &&
    parsed.memorySize >= 8 * parsed.parallelism &&
    parsed.memorySize <= MAX_MEMORY_KIB &&
    parsed.iterations >= 1 &&
    parsed.iterations <= MAX_ITERATIONS &&
    parsed.memorySize * parsed.iterations <= MAX_MEMORY_PASSES &&
    parsed.salt.length >= MIN_SALT_BYTES &&
    parsed.hash.length >= MIN_HASH_BYTES;
  return withinBounds ? Object.freeze(parsed) : undefined;
};

/**
 * `UI_PASSWORD`: an argon2id hash when it starts with `$argon2`, the password itself
 * otherwise, kept exactly as written. A hash that cannot be read is refused at startup
 * rather than compared as a plain password nobody would ever type.
 */
export const uiPassword = z
  .string()
  .min(1)
  .transform((value, ctx): UiPassword => {
    if (!value.startsWith(HASH_PREFIX)) return Object.freeze({ kind: 'plain', value });
    const hash = parseArgon2id(value);
    if (hash !== undefined) return hash;
    ctx.addIssue({ code: 'custom', message: NOT_A_HASH });
    return z.NEVER;
  });
