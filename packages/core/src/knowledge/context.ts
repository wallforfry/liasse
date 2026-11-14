import type { Database } from '../db/client.ts';
import type { EntityExecutor } from '../entities/entity-lock.ts';
import type { IdentifierKey } from '../entities/sensitive.ts';
import type { Embedder, TextModel } from '../models/ports.ts';

export interface KnowledgeReadContext {
  readonly db: Database;
}

// For the writes a caller may want inside a transaction of its own.
export interface KnowledgeWriteContext {
  readonly db: EntityExecutor;
}

export interface KnowledgeContext extends KnowledgeReadContext {
  readonly embedder: Embedder;
  readonly textModel: TextModel;
  // `deriveIdentifierKey(config.auth.fileUrlSecret)`, the key of the entities: an IBAN
  // given as the identifier of an account is hashed as it is on an entity.
  readonly identifierKey: IdentifierKey;
}
