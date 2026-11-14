import { describe, expect, it } from 'vitest';
import { InvalidStorageKeyError } from './errors.ts';
import { parseStorageKey, storageKeyOf } from './key.ts';

const SHA256 = 'ab12'.padEnd(64, '0');
const KEY = `ab/12/${SHA256}`;

describe('storage keys', () => {
  it('derives a sharded key from a SHA-256', () => {
    expect(storageKeyOf(SHA256)).toBe(KEY);
  });

  it('reads back a key it derived', () => {
    expect(parseStorageKey(KEY)).toBe(KEY);
  });

  it.each([
    ['an empty value', ''],
    ['a short hash', 'abcd'],
    ['uppercase digits', SHA256.toUpperCase()],
    ['a hash with a path separator', `../${SHA256.slice(3)}`],
    ['a trailing newline', `${SHA256}\n`],
  ])('refuses to derive a key from %s', (_label, value) => {
    expect(() => storageKeyOf(value)).toThrow(InvalidStorageKeyError);
  });

  it.each([
    ['a parent directory', `../${KEY}`],
    ['an absolute path', `/${KEY}`],
    ['a traversal inside the shards', `ab/../${SHA256}`],
    ['shards that do not match the hash', `cd/12/${SHA256}`],
    ['a bare hash', SHA256],
    ['a suffix', `${KEY}.tmp`],
    ['a NUL byte', `${KEY}\0`],
  ])('refuses %s as a stored key', (_label, value) => {
    expect(() => parseStorageKey(value)).toThrow(InvalidStorageKeyError);
  });

  it('keeps the rejected value out of the error', () => {
    const message = (() => {
      try {
        parseStorageKey('../synthetic-secret-path');
      } catch (error) {
        return String(error);
      }
      return '';
    })();
    expect(message).toContain('InvalidStorageKeyError');
    expect(message).not.toContain('synthetic-secret-path');
  });
});
