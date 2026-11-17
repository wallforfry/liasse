import { createDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { createTestAuth } from './test-auth.ts';

export interface AccountSeed {
  readonly databaseUrl: string;
  /** `EMBEDDING_DIM`, which the migration of a new database needs. */
  readonly embeddingDim: number;
  /** The `PUBLIC_URL` of the server that will run on it. */
  readonly publicUrl: string;
}

/**
 * Migrates the database and creates the test account in it, unless an account exists:
 * for a server a test starts past its onboarding.
 */
export const seedTestAccount = async ({
  databaseUrl,
  embeddingDim,
  publicUrl,
}: AccountSeed): Promise<void> => {
  await migrate(databaseUrl, { embeddingDim });
  const database = createDb(databaseUrl);
  try {
    await createTestAuth(database.db, publicUrl);
  } finally {
    await database.close();
  }
};
