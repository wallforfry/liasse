import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import { EMBEDDING_DIM_PLACEHOLDER } from './columns.ts';
import {
  assertInstalledEmbeddingDimension,
  assertValidEmbeddingDimension,
} from './embedding-dimension.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));

// Arbitrary constant: concurrent runners serialize on this advisory lock.
const MIGRATION_LOCK_KEY = 5_417_329;

const lastAppliedRows = z.array(z.object({ created_at: z.coerce.number() }));

// Same bookkeeping table as Drizzle's own migrator, so its tooling keeps working.
const lastAppliedMillis = async (sql: postgres.ISql): Promise<number> => {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;
  const [last] = lastAppliedRows.parse(
    await sql`
      SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1
    `,
  );
  return last?.created_at ?? -1;
};

const applyPending = async (sql: postgres.ISql, embeddingDim: number): Promise<void> => {
  const appliedUntil = await lastAppliedMillis(sql);
  const pending = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).filter(
    (migration) => migration.folderMillis > appliedUntil,
  );
  for (const migration of pending) {
    for (const statement of migration.sql) {
      await sql.unsafe(statement.replaceAll(EMBEDDING_DIM_PLACEHOLDER, String(embeddingDim)));
    }
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${migration.hash}, ${migration.folderMillis})
    `;
  }
};

export interface MigrateOptions {
  readonly embeddingDim: number;
}

export const migrate = async (
  databaseUrl: string,
  { embeddingDim }: MigrateOptions,
): Promise<void> => {
  assertValidEmbeddingDimension(embeddingDim);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
      await assertInstalledEmbeddingDimension(transaction, embeddingDim);
      await applyPending(transaction, embeddingDim);
    });
  } finally {
    await sql.end();
  }
};
