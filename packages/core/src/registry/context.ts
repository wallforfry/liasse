import type { SchemaLanguage } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import type { Embedder } from '../models/ports.ts';
import type { RegistryExecutor } from './type-store.ts';

export interface RegistryReadContext {
  readonly db: Database;
}

// For the writes a caller may want inside a transaction of its own.
export interface RegistryWriteContext {
  readonly db: RegistryExecutor;
}

export interface RegistryContext extends RegistryReadContext {
  readonly embedder: Embedder;
  // `schema_language` of the settings: the language slugs are generated in.
  readonly schemaLanguage: SchemaLanguage;
  readonly now?: () => Date;
}
