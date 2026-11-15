import type { SchemaLanguage } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import type { Embedder } from '../models/ports.ts';
import type { ChunkRanker } from '../search/rankers.ts';
import type { Storage } from '../storage/port.ts';
import type { ApiFeatures } from './features.ts';
import type { FileUrls } from './file-url.ts';

/** What the use cases need. REST and MCP are given the same one. */
export interface ApiContext {
  readonly db: Database;
  readonly storage: Storage;
  readonly embedder: Embedder;
  /** The full-text side of hybrid search, chosen at startup by `prepareFullTextRanking`. */
  readonly fullText: ChunkRanker;
  /** `SCHEMA_LANGUAGE` of the configuration: the language a type created by hand is named in. */
  readonly schemaLanguage: SchemaLanguage;
  /** In bytes; `config.pipeline.maxFileSize`. */
  readonly maxFileSize: number;
  readonly fileUrls: FileUrls;
  readonly features: ApiFeatures;
  /** Upper bound of each statement of a structured query; the default of `runQuery` when absent. */
  readonly queryTimeoutMs?: number;
}
