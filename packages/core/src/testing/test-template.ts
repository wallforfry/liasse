import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MIGRATIONS_FOLDER, migrate } from '../db/migrate.ts';
import { readMigrationFiles } from '../db/migration-files.ts';
import {
  type AdminSql,
  databaseExists,
  newTestDatabaseName,
  urlOfDatabase,
} from './test-server.ts';

/** A migrated database that test databases are copied from; one per migrations and dimension. */
export const TEMPLATE_DATABASE_PREFIX = 'liasse_template_';

// `migrate` identifies an applied migration by its content hash and its journal date, and
// refuses a database where either differs; the digest covers both.
const migrationsDigest = (migrationsFolder: string): string =>
  createHash('sha256')
    .update(
      readMigrationFiles(migrationsFolder)
        .map(({ hash, createdAt }) => `${hash}@${String(createdAt)}`)
        .join('\n'),
    )
    .digest('hex')
    .slice(0, 16);

// A changed or re-dated migration names another template, so a stale one is never copied.
export const templateDatabaseName = (
  embeddingDim: number,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): string =>
  `${TEMPLATE_DATABASE_PREFIX}${migrationsDigest(migrationsFolder)}_${String(embeddingDim)}`;

type LockMode = 'shared' | 'exclusive';

// Session advisory locks keyed on the template name, taken on the one admin connection:
// copies share it, building and dropping the template hold it alone. A killed process
// loses its connection and with it the lock.
const withTemplateLock = async <T>(
  sql: AdminSql,
  template: string,
  mode: LockMode,
  use: () => Promise<T>,
): Promise<T> => {
  await (mode === 'shared'
    ? sql`SELECT pg_advisory_lock_shared(hashtext(${template}))`
    : sql`SELECT pg_advisory_lock(hashtext(${template}))`);
  try {
    return await use();
  } finally {
    await (mode === 'shared'
      ? sql`SELECT pg_advisory_unlock_shared(hashtext(${template}))`
      : sql`SELECT pg_advisory_unlock(hashtext(${template}))`);
  }
};

// Built under a test database name, so a build cut short is cleaned like a leaked test
// database, and published by the rename, so a template that exists is complete.
const buildTemplate = async (
  sql: AdminSql,
  template: string,
  embeddingDim: number,
): Promise<void> => {
  const build = newTestDatabaseName();
  await sql.unsafe(`CREATE DATABASE ${build}`);
  try {
    await migrate(urlOfDatabase(build), { embeddingDim });
    // A session left on a template makes every copy of it fail.
    await sql.unsafe(`ALTER DATABASE ${build} WITH ALLOW_CONNECTIONS false`);
    await sql.unsafe(`ALTER DATABASE ${build} RENAME TO ${template}`);
  } catch (error) {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${build} WITH (FORCE)`);
    throw error;
  }
};

/**
 * Creates `name` as a copy of the migrated template of `embeddingDim`, building the
 * template first when no test run has yet. Copying is much cheaper than migrating: no
 * transaction holding a lock per migrated object, and no DDL replayed per test file.
 */
export const createMigratedDatabase = async (
  sql: AdminSql,
  name: string,
  embeddingDim: number,
): Promise<void> => {
  const template = templateDatabaseName(embeddingDim);
  const copied = await withTemplateLock(sql, template, 'shared', async () => {
    if (!(await databaseExists(sql, template))) return false;
    await sql.unsafe(`CREATE DATABASE ${name} TEMPLATE ${template}`);
    return true;
  });
  if (copied) return;
  await withTemplateLock(sql, template, 'exclusive', async () => {
    if (!(await databaseExists(sql, template))) await buildTemplate(sql, template, embeddingDim);
  });
  // `db:clean-test` may drop the template between the build and the copy.
  await createMigratedDatabase(sql, name, embeddingDim);
};

const lockedRows = z.tuple([z.object({ locked: z.boolean() })]);

/** Drops a template unless a test is copying or building it; resolves to whether it did. */
export const dropIdleTemplate = async (sql: AdminSql, template: string): Promise<boolean> => {
  const [{ locked }] = lockedRows.parse(
    await sql`SELECT pg_try_advisory_lock(hashtext(${template})) AS locked`,
  );
  if (!locked) return false;
  try {
    await sql.unsafe(`DROP DATABASE IF EXISTS ${template}`);
    return true;
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext(${template}))`;
  }
};
