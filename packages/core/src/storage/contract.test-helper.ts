import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageObjectNotFoundError } from './errors.ts';
import { type StorageKey, storageKeyOf } from './key.ts';
import type { Storage } from './port.ts';

export interface StorageUnderTest {
  readonly storage: Storage;
  readonly dispose: () => Promise<void>;
}

export const keyOf = (bytes: Uint8Array): StorageKey =>
  storageKeyOf(createHash('sha256').update(bytes).digest('hex'));

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

// The behaviour every driver owes its callers, run against the real backend of each.
export const describeStorageContract = (
  name: string,
  setup: () => Promise<StorageUnderTest>,
): void => {
  describe(`${name} storage contract`, () => {
    let under: StorageUnderTest;

    beforeAll(async () => {
      under = await setup();
    });

    afterAll(async () => {
      await under.dispose();
    });

    it('returns the bytes it was given, whole and as a stream', async () => {
      const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 251);
      const key = keyOf(bytes);
      await under.storage.put(key, bytes);
      expect(Buffer.from(await under.storage.get(key)).equals(Buffer.from(bytes))).toBe(true);
      const streamed = await buffer(await under.storage.getStream(key));
      expect(streamed.equals(Buffer.from(bytes))).toBe(true);
    });

    it('tells a stored key from an absent one', async () => {
      const bytes = bytesOf('synthetic stored file');
      const key = keyOf(bytes);
      expect(await under.storage.exists(key)).toBe(false);
      await under.storage.put(key, bytes);
      expect(await under.storage.exists(key)).toBe(true);
    });

    it('rejects reads of an absent key with a typed error', async () => {
      const key = keyOf(bytesOf('synthetic absent file'));
      await expect(under.storage.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
      await expect(under.storage.getStream(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    });

    it('accepts the same key twice and keeps one object', async () => {
      const bytes = bytesOf('synthetic file written twice');
      const key = keyOf(bytes);
      await Promise.all([under.storage.put(key, bytes), under.storage.put(key, bytes)]);
      await under.storage.put(key, bytes);
      expect(new TextDecoder().decode(await under.storage.get(key))).toBe(
        'synthetic file written twice',
      );
    });

    it('deletes a key, and deletes an absent key without failing', async () => {
      const bytes = bytesOf('synthetic deleted file');
      const key = keyOf(bytes);
      await under.storage.put(key, bytes);
      await under.storage.delete(key);
      expect(await under.storage.exists(key)).toBe(false);
      await expect(under.storage.delete(key)).resolves.toBeUndefined();
    });

    it('stores an empty file', async () => {
      const key = keyOf(new Uint8Array());
      await under.storage.put(key, new Uint8Array());
      expect(await under.storage.get(key)).toHaveLength(0);
    });

    it('passes its own startup check', async () => {
      await expect(under.storage.check()).resolves.toBeUndefined();
    });
  });
};
