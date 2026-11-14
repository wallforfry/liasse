import type { Readable } from 'node:stream';
import type { StorageKey } from './key.ts';

export interface Storage {
  /** Idempotent: writing a key twice leaves one object. Never exposes a partial object. */
  readonly put: (key: StorageKey, bytes: Uint8Array) => Promise<void>;
  /** Rejects with `StorageObjectNotFoundError` when the key is absent. */
  readonly get: (key: StorageKey) => Promise<Uint8Array>;
  /** Rejects with `StorageObjectNotFoundError` before any byte is produced. */
  readonly getStream: (key: StorageKey) => Promise<Readable>;
  readonly exists: (key: StorageKey) => Promise<boolean>;
  /** Idempotent: deleting an absent key succeeds. */
  readonly delete: (key: StorageKey) => Promise<void>;
}
