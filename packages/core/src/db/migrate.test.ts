import {
  CHANGE_KINDS,
  CHANGE_STATUSES,
  DOCUMENT_SOURCES,
  DOCUMENT_STATES,
  DOCUMENT_STATUSES,
  ENTITY_KINDS,
  JOB_STATUSES,
  KEY_DATE_KINDS,
  LINK_KINDS,
  SUBJECT_KINDS,
  TYPE_STATUSES,
} from '@liasse/contract/domain';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import {
  EmbeddingDimensionMismatchError,
  installedEmbeddingDimensions,
} from './embedding-dimension.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';
import { readMigrationFiles } from './migration-files.ts';

const TABLES = [
  'chunks',
  'doc_types',
  'document_dates',
  'document_links',
  'document_pages',
  'documents',
  'entities',
  'facts',
  'jobs',
  'subjects',
  'type_changes',
];

const column = async (
  { db }: TestDatabase,
  query: ReturnType<typeof sql>,
): Promise<readonly unknown[]> => (await db.execute(query)).map((row) => row.value);

const publicTables = (database: TestDatabase) =>
  column(
    database,
    sql`SELECT tablename AS value FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );

const appliedMigrations = (database: TestDatabase) =>
  column(database, sql`SELECT hash AS value FROM drizzle.__drizzle_migrations ORDER BY id`);

const withClient = async <T>(
  url: string,
  use: (client: postgres.Sql) => Promise<T>,
): Promise<T> => {
  const client = postgres(url, { max: 1 });
  try {
    return await use(client);
  } finally {
    await client.end();
  }
};

describe('migrate', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('creates the eleven tables on an empty database', async () => {
    expect(await publicTables(database)).toEqual(TABLES);
  });

  it('creates the vector and unaccent extensions', async () => {
    expect(
      await column(
        database,
        sql`SELECT extname AS value FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
      ),
    ).toEqual(['unaccent', 'vector']);
  });

  it('is a no-op when applied twice', async () => {
    const before = await appliedMigrations(database);
    await migrate(database.url, { embeddingDim: 384 });
    expect(before).toHaveLength(readMigrationFiles(MIGRATIONS_FOLDER).length);
    expect(await appliedMigrations(database)).toEqual(before);
    expect(await publicTables(database)).toEqual(TABLES);
  });

  it('installs EMBEDDING_DIM on every vector column', async () => {
    expect(await withClient(database.url, installedEmbeddingDimensions)).toEqual([384]);
    expect(
      await column(
        database,
        sql`
          SELECT format_type(a.atttypid, a.atttypmod) AS value
          FROM pg_attribute a
          WHERE a.attrelid IN ('chunks'::regclass, 'doc_types'::regclass, 'entities'::regclass,
                               'subjects'::regclass, 'facts'::regclass)
            AND a.attname = 'embedding'
        `,
      ),
    ).toEqual(Array.from({ length: 5 }, () => 'vector(384)'));
  });

  it('refuses to start when EMBEDDING_DIM differs from the installed dimension', async () => {
    const failure = migrate(database.url, { embeddingDim: 768 });
    await expect(failure).rejects.toBeInstanceOf(EmbeddingDimensionMismatchError);
    await expect(failure).rejects.toMatchObject({ installed: 384, requested: 768 });
    await expect(failure).rejects.toThrow(
      'EMBEDDING_DIM=768 does not match the embedding dimension 384',
    );
    expect(await withClient(database.url, installedEmbeddingDimensions)).toEqual([384]);
  });

  it.each([0, -3, 1.5, 2001, Number.NaN])('rejects the invalid dimension %s', async (dim) => {
    await expect(migrate(database.url, { embeddingDim: dim })).rejects.toBeInstanceOf(RangeError);
  });

  it('keeps the pg enums equal to the domain enumerations', async () => {
    const rows = await database.db.execute(sql`
      SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      GROUP BY t.typname
    `);
    expect(Object.fromEntries(rows.map((row) => [row.name, row.labels]))).toEqual({
      change_kind: CHANGE_KINDS,
      change_status: CHANGE_STATUSES,
      document_source: DOCUMENT_SOURCES,
      document_state: DOCUMENT_STATES,
      document_status: DOCUMENT_STATUSES,
      entity_kind: ENTITY_KINDS,
      job_status: JOB_STATUSES,
      key_date_kind: KEY_DATE_KINDS,
      link_kind: LINK_KINDS,
      subject_kind: SUBJECT_KINDS,
      type_status: TYPE_STATUSES,
    });
  });

  it.each([
    ['chunks_language_idx', 'USING btree (language)'],
    ['document_pages_tsv_idx', 'USING gin (tsv)'],
    ['chunks_tsv_idx', 'USING gin (tsv)'],
    ['facts_tsv_idx', 'USING gin (tsv)'],
    ['chunks_embedding_idx', 'USING hnsw (embedding vector_cosine_ops)'],
    ['facts_embedding_idx', 'USING hnsw (embedding vector_cosine_ops)'],
    ['facts_entity_ids_idx', 'USING gin (entity_ids)'],
    ['facts_subject_ids_idx', 'USING gin (subject_ids)'],
    ['documents_subject_ids_idx', 'USING gin (subject_ids)'],
    ['jobs_dequeue_idx', "USING btree (run_after) WHERE (status = 'queued'::job_status)"],
  ])('creates the index %s', async (name, definition) => {
    expect(
      await column(
        database,
        sql`SELECT indexdef AS value FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${name}`,
      ),
    ).toEqual([expect.stringContaining(definition)]);
  });
});

describe('migrate with another dimension', () => {
  it('installs the requested dimension', async () => {
    const database = await createTestDatabase({ embeddingDim: 8 });
    try {
      expect(await withClient(database.url, installedEmbeddingDimensions)).toEqual([8]);
    } finally {
      await database.dispose();
    }
  });
});

describe('migrate beside a vector column that is not ours', () => {
  it('installs without mistaking it for the installed dimension', async () => {
    const database = await createTestDatabase({ migrate: false });
    try {
      await database.db.execute(sql`CREATE EXTENSION vector`);
      await database.db.execute(sql`CREATE TABLE foreign_vectors (embedding vector(3))`);
      await migrate(database.url, { embeddingDim: 384 });
      expect(await withClient(database.url, installedEmbeddingDimensions)).toEqual([384]);
    } finally {
      await database.dispose();
    }
  });
});

describe('createTestDatabase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails when the test database is unreachable', async () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://liasse:liasse@127.0.0.1:1/liasse_test');
    await expect(createTestDatabase()).rejects.toThrow();
  });
});
