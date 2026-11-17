import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { z } from 'zod';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://liasse:liasse@127.0.0.1:54332/liasse_test';

/** Every throwaway database of the tests starts with it, and nothing else does. */
export const TEST_DATABASE_PREFIX = 'liasse_test_';

// The server is shared with every other test file and session. Saturated, it took more than
// five seconds to accept a connection, which failed whole test files before they ran. The
// limit sits just under the 30 s a test or a hook is given, so an unreachable server is still
// reported by this helper.
const CONNECT_TIMEOUT_SECONDS = 25;

export type AdminSql = postgres.Sql;

const adminUrl = (): string => process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

/** One connection to the test server, ended once `use` settles. */
export const withAdmin = async <T>(use: (sql: AdminSql) => Promise<T>): Promise<T> => {
  const sql = postgres(adminUrl(), {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => undefined,
  });
  try {
    return await use(sql);
  } finally {
    await sql.end();
  }
};

export const urlOfDatabase = (name: string): string => {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
};

export const newTestDatabaseName = (): string =>
  `${TEST_DATABASE_PREFIX}${randomBytes(8).toString('hex')}`;

const existsRows = z.tuple([z.object({ exists: z.boolean() })]);

export const databaseExists = async (sql: AdminSql, name: string): Promise<boolean> => {
  const [{ exists }] = existsRows.parse(
    await sql`SELECT EXISTS (SELECT FROM pg_database WHERE datname = ${name}) AS exists`,
  );
  return exists;
};
