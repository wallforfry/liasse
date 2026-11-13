import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { z } from 'zod';
import { EMBEDDING_DIM_PLACEHOLDER } from './columns.ts';
import {
  assertInstalledEmbeddingDimension,
  assertValidEmbeddingDimension,
} from './embedding-dimension.ts';
import { readMigrationFiles } from './migration-files.ts';
import { type AppliedMigration, pendingMigrations } from './migration-history.ts';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));

// Arbitrary constant: concurrent runners serialize on this advisory lock.
const MIGRATION_LOCK_KEY = 5_417_329;

const appliedRows = z.array(z.object({ hash: z.string(), created_at: z.coerce.number() }));

// Same bookkeeping table as Drizzle's own migrator, so its tooling keeps working.
const appliedMigrations = async (sql: postgres.ISql): Promise<readonly AppliedMigration[]> => {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  return appliedRows
    .parse(await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`)
    .map((row) => ({ hash: row.hash, createdAt: row.created_at }));
};

interface ApplyOptions {
  readonly embeddingDim: number;
  readonly migrationsFolder: string;
}

const applyPending = async (
  sql: postgres.ISql,
  { embeddingDim, migrationsFolder }: ApplyOptions,
): Promise<void> => {
  const pending = pendingMigrations(
    await appliedMigrations(sql),
    readMigrationFiles(migrationsFolder),
  );
  for (const migration of pending) {
    for (const statement of migration.statements) {
      await sql.unsafe(statement.replaceAll(EMBEDDING_DIM_PLACEHOLDER, String(embeddingDim)));
    }
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${migration.hash}, ${migration.createdAt})
    `;
  }
};

export interface MigrateOptions {
  readonly embeddingDim: number;
  readonly migrationsFolder?: string;
}

export const migrate = async (
  databaseUrl: string,
  { embeddingDim, migrationsFolder = MIGRATIONS_FOLDER }: MigrateOptions,
): Promise<void> => {
  assertValidEmbeddingDimension(embeddingDim);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
      await assertInstalledEmbeddingDimension(transaction, embeddingDim);
      await applyPending(transaction, { embeddingDim, migrationsFolder });
    });
  } finally {
    await sql.end();
  }
};
