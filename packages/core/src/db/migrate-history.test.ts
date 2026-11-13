import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StartupError } from '../domain/errors.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';

const journalSchema = z.looseObject({
  entries: z.array(z.looseObject({ idx: z.number(), when: z.number(), tag: z.string() })),
});
type Journal = z.infer<typeof journalSchema>;

const journalPath = (folder: string): string => join(folder, 'meta', '_journal.json');

const readJournal = (folder: string): Journal =>
  journalSchema.parse(JSON.parse(readFileSync(journalPath(folder), 'utf8')));

const writeJournal = (folder: string, journal: Journal): void => {
  writeFileSync(journalPath(folder), JSON.stringify(journal));
};

interface ExtraMigration {
  readonly tag: string;
  readonly when: number;
  readonly sql: string;
}

const addMigration = (folder: string, { tag, when, sql: content }: ExtraMigration): void => {
  const journal = readJournal(folder);
  writeFileSync(join(folder, `${tag}.sql`), content);
  writeJournal(folder, {
    ...journal,
    entries: [
      ...journal.entries,
      { idx: journal.entries.length, version: '7', when, tag, breakpoints: true },
    ],
  });
};

const count = async ({ db }: TestDatabase, query: ReturnType<typeof sql>): Promise<unknown> =>
  (await db.execute(query))[0]?.count;

const publicTableCount = (database: TestDatabase) =>
  count(database, sql`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`);

const tableExists = (database: TestDatabase, name: string) =>
  count(
    database,
    sql`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND tablename = ${name}`,
  );

const recordedMigrationCount = (database: TestDatabase) =>
  count(database, sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`);

describe('migrate against the recorded history', () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  const copyOfMigrations = (): string => {
    const folder = mkdtempSync(join(tmpdir(), 'liasse-migrations-'));
    cleanups.push(() => {
      rmSync(folder, { recursive: true, force: true });
    });
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    return folder;
  };

  const testDatabase = async (options: { migrate: boolean }): Promise<TestDatabase> => {
    const database = await createTestDatabase(options);
    cleanups.push(database.dispose);
    return database;
  };

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('applies a migration older than the last applied one', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    addMigration(migrationsFolder, {
      tag: '0002_from_a_parallel_branch',
      when: 1,
      sql: 'CREATE TABLE merged_late (id text PRIMARY KEY);',
    });

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });

    expect(await tableExists(database, 'merged_late')).toBe(1);
    expect(await recordedMigrationCount(database)).toBe(3);

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await recordedMigrationCount(database)).toBe(3);
  });

  it('refuses to run when an applied migration was edited', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    writeFileSync(
      join(migrationsFolder, '0001_initial_schema.sql'),
      `${readFileSync(join(migrationsFolder, '0001_initial_schema.sql'), 'utf8')}\n-- edited`,
    );

    const failure = migrate(database.url, { embeddingDim: 384, migrationsFolder });
    await expect(failure).rejects.toBeInstanceOf(StartupError);
    await expect(failure).rejects.toThrow(/0001_initial_schema was modified after it was applied/);
    expect(await recordedMigrationCount(database)).toBe(2);
  });

  it('refuses to run when the database records a migration the folder does not have', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    const journal = readJournal(migrationsFolder);
    writeJournal(migrationsFolder, { ...journal, entries: journal.entries.slice(0, 1) });

    const failure = migrate(database.url, { embeddingDim: 384, migrationsFolder });
    await expect(failure).rejects.toBeInstanceOf(StartupError);
    await expect(failure).rejects.toThrow(/1 applied migration that .* does not contain/);
  });

  it('lets concurrent runners migrate an empty database exactly once', async () => {
    const database = await testDatabase({ migrate: false });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => migrate(database.url, { embeddingDim: 384 })),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(
      Array.from({ length: 8 }, () => 'fulfilled'),
    );
    expect(await recordedMigrationCount(database)).toBe(2);
    expect(await publicTableCount(database)).toBe(11);
  });

  it('leaves nothing behind when a migration fails', async () => {
    const database = await testDatabase({ migrate: false });
    const migrationsFolder = copyOfMigrations();
    addMigration(migrationsFolder, {
      tag: '0002_broken',
      when: Date.now() + 1000,
      sql: [
        'CREATE TABLE half_applied (id text PRIMARY KEY);',
        'ALTER TABLE table_that_does_not_exist ADD COLUMN broken text;',
      ].join('--> statement-breakpoint\n'),
    });

    await expect(migrate(database.url, { embeddingDim: 384, migrationsFolder })).rejects.toThrow(
      /table_that_does_not_exist/,
    );

    expect(await publicTableCount(database)).toBe(0);
    expect(
      await count(
        database,
        sql`SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = 'drizzle'`,
      ),
    ).toBe(0);
  });
});
