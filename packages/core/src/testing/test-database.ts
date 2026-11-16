import { createDb, type Database } from '../db/client.ts';
import { createMigratedDatabase } from './test-template.ts';
import { newTestDatabaseName, urlOfDatabase, withAdmin } from './test-server.ts';

export const TEST_EMBEDDING_DIM = 384;

export interface TestDatabaseOptions {
  readonly embeddingDim?: number;
  readonly migrate?: boolean;
  /** The template to copy; the shared one of `embeddingDim` by default. */
  readonly template?: string;
}

export interface TestDatabase {
  readonly url: string;
  readonly db: Database;
  readonly ping: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

// One throwaway database per caller keeps test files independent, so they can run in
// parallel. An unreachable server rejects here, which fails the calling test.
export const createTestDatabase = async ({
  embeddingDim = TEST_EMBEDDING_DIM,
  migrate: shouldMigrate = true,
  template,
}: TestDatabaseOptions = {}): Promise<TestDatabase> => {
  const name = newTestDatabaseName();
  await withAdmin(async (sql) => {
    if (shouldMigrate) await createMigratedDatabase(sql, name, embeddingDim, template);
    else await sql.unsafe(`CREATE DATABASE ${name}`);
  });
  const url = urlOfDatabase(name);
  const { db, ping, close } = createDb(url);
  return {
    url,
    db,
    ping,
    dispose: async () => {
      await close();
      await withAdmin((sql) => sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    },
  };
};
