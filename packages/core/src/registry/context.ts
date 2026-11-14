import type { Database } from '../db/client.ts';
import type { SchemaLanguage } from '../domain/enums.ts';
import type { Embedder } from '../models/ports.ts';

export interface RegistryReadContext {
  readonly db: Database;
}

export interface RegistryContext extends RegistryReadContext {
  readonly embedder: Embedder;
  // `MAX_NEW_TYPES_PER_DAY` of the configuration.
  readonly maxNewTypesPerDay: number;
  // `SCHEMA_LANGUAGE` of the configuration: the language slugs are generated in.
  readonly schemaLanguage: SchemaLanguage;
  readonly now?: () => Date;
}
