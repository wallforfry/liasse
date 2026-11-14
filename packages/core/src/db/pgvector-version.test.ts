import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StartupError } from '../domain/errors.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { migrate } from './migrate.ts';
import {
  assertSupportedPgvector,
  availablePgvectorVersion,
  MIN_PGVECTOR_VERSION,
  PgvectorVersionError,
} from './pgvector-version.ts';

describe('the pgvector version', () => {
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

  const publicTableCount = async (): Promise<unknown> =>
    (await sql`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`)[0]?.count;

  it('reads the version the server would install, then the one that is installed', async () => {
    const [available] =
      await sql`SELECT default_version FROM pg_available_extensions WHERE name = 'vector'`;
    expect(await availablePgvectorVersion(sql)).toBe(available?.default_version);
    await sql`CREATE EXTENSION vector`;
    try {
      const [installed] = await sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
      expect(await availablePgvectorVersion(sql)).toBe(installed?.extversion);
      expect(installed?.extversion).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      await sql`DROP EXTENSION vector`;
    }
  });

  it.each(['0.8.0', '0.8.7', '0.10.1', '1.0.0', '0.9'])('accepts pgvector %s', (version) => {
    expect(MIN_PGVECTOR_VERSION).toEqual([0, 8, 0]);
    expect(() => {
      assertSupportedPgvector(version);
    }).not.toThrow();
  });

  it.each(['0.7.4', '0.5.1', '0.7', 'unknown', ''])('refuses pgvector %j', (version) => {
    expect(() => {
      assertSupportedPgvector(version);
    }).toThrow(PgvectorVersionError);
  });

  it('names the requirement and the way out', () => {
    const refuse = () => {
      assertSupportedPgvector('0.7.4');
    };
    expect(refuse).toThrow(StartupError);
    expect(refuse).toThrow(
      'Liasse needs pgvector 0.8.0 or later and this database has pgvector 0.7.4.',
    );
    expect(refuse).toThrow('ALTER EXTENSION vector UPDATE');
    expect(() => {
      assertSupportedPgvector(undefined);
    }).toThrow('this database has no pgvector to install');
  });

  it('refuses to migrate a database whose pgvector is too old, and leaves it untouched', async () => {
    const failure = migrate(database.url, {
      embeddingDim: 384,
      readPgvectorVersion: () => Promise.resolve('0.7.4'),
    });
    await expect(failure).rejects.toBeInstanceOf(PgvectorVersionError);
    await expect(failure).rejects.toMatchObject({ installed: '0.7.4' });
    expect(await publicTableCount()).toBe(0);
  });

  it('migrates when the version is supported', async () => {
    await migrate(database.url, {
      embeddingDim: 384,
      readPgvectorVersion: () => Promise.resolve('0.8.0'),
    });
    expect(await publicTableCount()).toBeGreaterThan(0);
  });
});
