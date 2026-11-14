import type { Database } from '../db/client.ts';
import type { Embedder, TextModel } from '../models/ports.ts';
import type { EntityExecutor } from './entity-lock.ts';
import type { IdentifierKey } from './sensitive.ts';

export interface EntitiesReadContext {
  readonly db: Database;
}

// For the writes a caller may want inside a transaction of its own.
export interface EntitiesWriteContext {
  readonly db: EntityExecutor;
}

export interface EntitiesContext extends EntitiesReadContext {
  readonly embedder: Embedder;
  readonly textModel: TextModel;
  // `deriveIdentifierKey(config.auth.fileUrlSecret)`.
  readonly identifierKey: IdentifierKey;
}
