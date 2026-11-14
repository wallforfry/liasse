import { z } from 'zod';
import { InvalidStorageKeyError } from './errors.ts';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHARD_LENGTH = 2;

const shardedKey = (sha256: string): string =>
  [sha256.slice(0, SHARD_LENGTH), sha256.slice(SHARD_LENGTH, 2 * SHARD_LENGTH), sha256].join('/');

// The brand is the only way to obtain a key, and a key is nothing but lowercase
// hexadecimal digits and two slashes: no driver can be handed a path that leaves its root.
const storageKeySchema = z
  .string()
  .refine((value) => {
    const sha256 = value.slice(value.lastIndexOf('/') + 1);
    return SHA256_PATTERN.test(sha256) && value === shardedKey(sha256);
  })
  .brand<'StorageKey'>();

export type StorageKey = z.infer<typeof storageKeySchema>;

const parseKey = (value: string): StorageKey => {
  const result = storageKeySchema.safeParse(value);
  if (!result.success) throw new InvalidStorageKeyError();
  return result.data;
};

export const storageKeyOf = (sha256: string): StorageKey => parseKey(shardedKey(sha256));

// For a key read back from `documents.storage_key`.
export const parseStorageKey = (value: string): StorageKey => parseKey(value);
