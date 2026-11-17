import { createAuth } from '../auth/create-auth.ts';
import { createFirstAccount } from '../auth/first-account.ts';
import { createDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { TEST_ACCOUNT, TEST_AUTH_SECRET, TEST_SESSION_TTL_MS } from './test-auth.ts';

export interface AccountSeed {
  readonly databaseUrl: string;
  /** `EMBEDDING_DIM`, which the migration of a new database needs. */
  readonly embeddingDim: number;
  /** The `PUBLIC_URL` of the server that will run on it. */
  readonly publicUrl: string;
  /** `TEST_ACCOUNT` unless given. */
  readonly account?: { readonly email: string; readonly password: string };
}

/**
 * Migrates the database and creates this account in it as the first one, unless an
 * account exists: for a server a test or an evaluation run starts past its onboarding.
 */
export const seedTestAccount = async ({
  databaseUrl,
  embeddingDim,
  publicUrl,
  account = TEST_ACCOUNT,
}: AccountSeed): Promise<void> => {
  await migrate(databaseUrl, { embeddingDim });
  const database = createDb(databaseUrl);
  try {
    // The secret signs sessions only: the password hash does not depend on it.
    const auth = createAuth({
      db: database.db,
      secret: TEST_AUTH_SECRET,
      publicUrl,
      sessionTtlMs: TEST_SESSION_TTL_MS,
      report: () => undefined,
    });
    await createFirstAccount(auth, database.db, { ...account, name: account.email });
  } finally {
    await database.close();
  }
};
