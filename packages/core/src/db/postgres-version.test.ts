import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StartupError } from '../domain/errors.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { migrate } from './migrate.ts';
import {
  assertSupportedPostgres,
  installedPostgresMajorVersion,
  MIN_POSTGRES_MAJOR_VERSION,
  PostgresVersionError,
} from './postgres-version.ts';

describe('the Postgres version', () => {
  let database: TestDatabase;
  let sql: postgres.Sql;

  beforeAll(async () => {
    database = await createTestDatabase({ migrate: false });
    sql = postgres(database.url, { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    await sql.end();
    await database.dispose();
  });

  it('reads the major version of the server', async () => {
    const [row] = await sql`SELECT current_setting('server_version') AS version`;
    const major = await installedPostgresMajorVersion(sql);
    expect(String(row?.version)).toMatch(new RegExp(`^${String(major)}\\.`));
    expect(major).toBeGreaterThanOrEqual(MIN_POSTGRES_MAJOR_VERSION);
  });

  it('accepts version 16 and later', () => {
    expect(MIN_POSTGRES_MAJOR_VERSION).toBe(16);
    expect(() => {
      assertSupportedPostgres(16);
    }).not.toThrow();
    expect(() => {
      assertSupportedPostgres(18);
    }).not.toThrow();
  });

  it('refuses an older server and says which version is needed', () => {
    const refusal = (): void => {
      assertSupportedPostgres(15);
    };
    expect(refusal).toThrow(PostgresVersionError);
    expect(refusal).toThrow(StartupError);
    expect(refusal).toThrow(
      'Liasse needs Postgres 16 or later and this server runs Postgres 15. Upgrade the server, then start again.',
    );
  });

  it('makes migrate refuse an older server before it applies anything', async () => {
    const outcome = migrate(database.url, {
      embeddingDim: 384,
      readPostgresVersion: () => Promise.resolve(15),
    });
    await expect(outcome).rejects.toBeInstanceOf(PostgresVersionError);
    const [row] =
      await sql`SELECT to_regclass('public.documents') AS documents, to_regnamespace('drizzle') AS history`;
    expect(row).toEqual({ documents: null, history: null });
  });

  it('lets migrate run on the server of the tests', async () => {
    await migrate(database.url, { embeddingDim: 384 });
    const [row] = await sql`SELECT to_regclass('public.documents') AS documents`;
    expect(row).toEqual({ documents: 'documents' });
  });
});
