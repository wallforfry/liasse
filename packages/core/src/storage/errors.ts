import { StartupError } from '../domain/errors.ts';

/**
 * The storage is set up wrongly (no such bucket, refused credentials, a directory that
 * cannot be written): retrying cannot help, the operator must fix the configuration.
 */
export class StorageMisconfiguredError extends StartupError {
  override readonly name = 'StorageMisconfiguredError';
}

export class StorageError extends Error {
  override readonly name: string = 'StorageError';
}

export class StorageObjectNotFoundError extends StorageError {
  override readonly name = 'StorageObjectNotFoundError';

  constructor(options?: ErrorOptions) {
    super('The stored file does not exist', options);
  }
}

// The rejected value is left out: a key is derived from a path the caller must not learn.
export class InvalidStorageKeyError extends StorageError {
  override readonly name = 'InvalidStorageKeyError';

  constructor() {
    super('A storage key is the sharded SHA-256 of a file');
  }
}
