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

const noteColumnCount = (database: TestDatabase) =>
  count(
    database,
    sql`
      SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'note'
    `,
  );

const SHIPPED = readJournal(MIGRATIONS_FOLDER).entries.length;

// Later than any real migration, so these entries sort after the shipped ones.
const BASE = Date.now() + 60_000;
const ADD_NOTE = 'ALTER TABLE jobs ADD COLUMN note text;';

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
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 1);

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 1);
  });

  const ADD_COLUMN = { tag: '0002_add_note', when: BASE + 1, sql: ADD_NOTE };
  const DROP_COLUMN = {
    tag: '0003_drop_note',
    when: BASE + 2,
    sql: 'ALTER TABLE jobs DROP COLUMN note;',
  };
  const ADD_COLUMN_AGAIN = { tag: '0004_add_note_again', when: BASE + 3, sql: ADD_NOTE };

  it('applies a migration whose content repeats an applied one', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    addMigration(migrationsFolder, ADD_COLUMN);
    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await noteColumnCount(database)).toBe(1);

    addMigration(migrationsFolder, DROP_COLUMN);
    addMigration(migrationsFolder, ADD_COLUMN_AGAIN);
    await migrate(database.url, { embeddingDim: 384, migrationsFolder });

    expect(await noteColumnCount(database)).toBe(1);
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 3);

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 3);
  });

  it('applies repeated content on an empty database, once per journal entry', async () => {
    const database = await testDatabase({ migrate: false });
    const migrationsFolder = copyOfMigrations();
    [ADD_COLUMN, DROP_COLUMN, ADD_COLUMN_AGAIN].forEach((migration) => {
      addMigration(migrationsFolder, migration);
    });

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await noteColumnCount(database)).toBe(1);
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 3);

    await migrate(database.url, { embeddingDim: 384, migrationsFolder });
    expect(await recordedMigrationCount(database)).toBe(SHIPPED + 3);
  });

  it('refuses to run when an applied migration was given another date', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    const journal = readJournal(migrationsFolder);
    writeJournal(migrationsFolder, {
      ...journal,
      entries: journal.entries.map((entry) =>
        entry.tag === '0001_initial_schema' ? { ...entry, when: entry.when + 1 } : entry,
      ),
    });

    const failure = migrate(database.url, { embeddingDim: 384, migrationsFolder });
    await expect(failure).rejects.toBeInstanceOf(StartupError);
    await expect(failure).rejects.toThrow(
      /0001_initial_schema was given another date in the journal after it was applied/,
    );
    expect(await recordedMigrationCount(database)).toBe(SHIPPED);
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
    expect(await recordedMigrationCount(database)).toBe(SHIPPED);
  });

  it('refuses to run when the database records a migration the folder does not have', async () => {
    const database = await testDatabase({ migrate: true });
    const migrationsFolder = copyOfMigrations();
    const journal = readJournal(migrationsFolder);
    writeJournal(migrationsFolder, { ...journal, entries: journal.entries.slice(0, -1) });

    const failure = migrate(database.url, { embeddingDim: 384, migrationsFolder });
    await expect(failure).rejects.toBeInstanceOf(StartupError);
    await expect(failure).rejects.toThrow(
      /1 applied migration that matches no migration of this version/,
    );
  });

  it('lets concurrent runners migrate an empty database exactly once', async () => {
    const database = await testDatabase({ migrate: false });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => migrate(database.url, { embeddingDim: 384 })),
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(
      Array.from({ length: 8 }, () => 'fulfilled'),
    );
    expect(await recordedMigrationCount(database)).toBe(SHIPPED);
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
