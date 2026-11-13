export { createDb, type Database, type DatabaseHandle } from './client.ts';
export type { JsonObject } from './columns.ts';
export {
  EmbeddingDimensionMismatchError,
  installedEmbeddingDimensions,
} from './embedding-dimension.ts';
export { migrate, type MigrateOptions } from './migrate.ts';
export { MigrationHistoryError } from './migration-history.ts';
export * from './schema/index.ts';
