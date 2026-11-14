import type { Database } from '../db/client.ts';
import type { SchemaLanguage } from '../domain/enums.ts';
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
  // `MAX_NEW_TYPES_PER_DAY` of the configuration.
  readonly maxNewTypesPerDay: number;
  // `SCHEMA_LANGUAGE` of the configuration: the language slugs are generated in.
  readonly schemaLanguage: SchemaLanguage;
  readonly now?: () => Date;
}
