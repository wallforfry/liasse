import type { Database } from '../db/client.ts';
import type { Embedder, TextModel } from '../models/ports.ts';
import type { EntityExecutor } from './entity-lock.ts';
import type { IdentifierKey } from './sensitive.ts';
import type { SimilarityThresholds } from './similarity.ts';

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
  // The thresholds of the similarity rule, from the pipeline settings; by default
  // those measured with the default local embedder.
  readonly similarity?: SimilarityThresholds;
}
