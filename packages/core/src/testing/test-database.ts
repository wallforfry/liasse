import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { createDb, type Database } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://liasse:liasse@127.0.0.1:54329/liasse_test';
export const TEST_EMBEDDING_DIM = 384;

// The server is shared with every other test file and session. Saturated, it took more than
// five seconds to accept a connection, which failed whole test files before they ran. The
// limit sits just under the 30 s a test or a hook is given, so an unreachable server is still
// reported by this helper.
const CONNECT_TIMEOUT_SECONDS = 25;

export interface TestDatabaseOptions {
  readonly embeddingDim?: number;
  readonly migrate?: boolean;
}

export interface TestDatabase {
  readonly url: string;
  readonly db: Database;
  readonly ping: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const adminUrl = (): string => process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

const runAsAdmin = async (statement: string): Promise<void> => {
  const admin = postgres(adminUrl(), {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => undefined,
  });
  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end();
  }
};

const urlOfDatabase = (name: string): string => {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
};

const dropDatabase = (name: string): Promise<void> =>
  runAsAdmin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);

// One throwaway database per caller keeps test files independent, so they can run in
// parallel. An unreachable server rejects here, which fails the calling test.
export const createTestDatabase = async ({
  embeddingDim = TEST_EMBEDDING_DIM,
  migrate: shouldMigrate = true,
}: TestDatabaseOptions = {}): Promise<TestDatabase> => {
  const name = `liasse_test_${randomBytes(8).toString('hex')}`;
  const url = urlOfDatabase(name);
  await runAsAdmin(`CREATE DATABASE ${name}`);
  try {
    if (shouldMigrate) await migrate(url, { embeddingDim });
  } catch (error) {
    await dropDatabase(name);
    throw error;
  }
  const { db, ping, close } = createDb(url);
  return {
    url,
    db,
    ping,
    dispose: async () => {
      await close();
      await dropDatabase(name);
    },
  };
};
