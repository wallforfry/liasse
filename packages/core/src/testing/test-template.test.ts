import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { installedEmbeddingDimensions } from '../db/embedding-dimension.ts';
import { MIGRATIONS_FOLDER } from '../db/migrate.ts';
import { readMigrationFiles } from '../db/migration-files.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';
import { databaseExists, withAdmin } from './test-server.ts';
import { dropIdleTemplate, templateDatabaseName } from './test-template.ts';

// No other test file uses this dimension, so this file alone builds and drops its template.
const OWN_DIM = 13;
const template = templateDatabaseName(OWN_DIM);

// Only the dates are rewritten; every other field of the journal is kept as it is.
const journalSchema = z.looseObject({
  entries: z.array(z.looseObject({ when: z.number() })),
});

const appliedHashes = async ({ db }: TestDatabase): Promise<readonly unknown[]> =>
  (await db.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`)).map(
    (row) => row.hash,
  );

const installedDimensions = async ({ db }: TestDatabase): Promise<readonly number[]> =>
  installedEmbeddingDimensions(db.$client);

const disposeAll = async (databases: readonly TestDatabase[]): Promise<void> => {
  await Promise.all(databases.map((database) => database.dispose()));
};

// When one copy fails, the others are still dropped before the failure is reported.
const createInParallel = async (count: number): Promise<readonly TestDatabase[]> => {
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => createTestDatabase({ embeddingDim: OWN_DIM })),
  );
  const created = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure === undefined) return created;
  await disposeAll(created);
  throw failure.reason;
};

describe('createTestDatabase from a template', () => {
  beforeAll(async () => {
    await withAdmin((admin) => dropIdleTemplate(admin, template));
  });
  afterAll(async () => {
    await withAdmin((admin) => dropIdleTemplate(admin, template));
  });

  it('builds the template once for copies made in parallel, each fully migrated', async () => {
    const databases = await createInParallel(4);
    try {
      const expected = readMigrationFiles(MIGRATIONS_FOLDER).map(({ hash }) => hash);
      const copies = await Promise.all(
        databases.map(async (database) => ({
          hashes: await appliedHashes(database),
          dimensions: await installedDimensions(database),
        })),
      );
      expect(copies).toEqual(databases.map(() => ({ hashes: expected, dimensions: [OWN_DIM] })));
      expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
    } finally {
      await disposeAll(databases);
    }
  });

  it('keeps a change made in one copy out of the template and of later copies', async () => {
    const first = await createTestDatabase({ embeddingDim: OWN_DIM });
    try {
      await first.db.execute(sql`CREATE TABLE only_in_first (id int)`);
      const second = await createTestDatabase({ embeddingDim: OWN_DIM });
      try {
        const hasTable = (database: TestDatabase) =>
          database.db
            .execute(sql`SELECT to_regclass('only_in_first') IS NOT NULL AS present`)
            .then((rows) => rows.map((row) => row.present));
        expect(await Promise.all([first, second].map(hasTable))).toEqual([[true], [false]]);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
    }
  });

  it('builds the template again once it has been dropped', async () => {
    await disposeAll([await createTestDatabase({ embeddingDim: OWN_DIM })]);
    expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(true);
    expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(false);
    const database = await createTestDatabase({ embeddingDim: OWN_DIM });
    try {
      expect(await installedDimensions(database)).toEqual([OWN_DIM]);
    } finally {
      await database.dispose();
    }
  });

  it('leaves a template alone while a copy holds its lock', async () => {
    await disposeAll([await createTestDatabase({ embeddingDim: OWN_DIM })]);
    await withAdmin(async (copying) => {
      await copying`SELECT pg_advisory_lock_shared(hashtext(${template}))`;
      expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(false);
    });
    expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
  });
});

describe('templateDatabaseName', () => {
  const folders: string[] = [];
  afterAll(() => {
    folders.forEach((folder) => {
      rmSync(folder, { recursive: true, force: true });
    });
  });

  const copyOfMigrations = (): string => {
    const folder = mkdtempSync(join(tmpdir(), 'liasse-migrations-'));
    folders.push(folder);
    cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
    return folder;
  };

  it('depends on the dimension and on the content of every migration', () => {
    const unchanged = copyOfMigrations();
    const changed = copyOfMigrations();
    const [first] = readMigrationFiles(changed);
    if (first === undefined) throw new Error('no migration found');
    appendFileSync(join(changed, `${first.tag}.sql`), '\n-- changed\n');

    expect(templateDatabaseName(OWN_DIM, unchanged)).toBe(template);
    expect(templateDatabaseName(OWN_DIM, changed)).not.toBe(template);
    expect(templateDatabaseName(OWN_DIM + 1, unchanged)).not.toBe(template);
    expect(template.length).toBeLessThanOrEqual(63);
  });

  // `migrate` identifies a migration by its content and its journal date: a copy carrying
  // the old date would be refused by every later `migrate`.
  it('depends on the journal date of every migration', () => {
    const redated = copyOfMigrations();
    const journalPath = join(redated, 'meta', '_journal.json');
    const journal = journalSchema.parse(JSON.parse(readFileSync(journalPath, 'utf8')));
    const entries = journal.entries.map((entry, index) =>
      index === 0 ? { ...entry, when: entry.when + 1 } : entry,
    );
    writeFileSync(journalPath, JSON.stringify({ ...journal, entries }));

    expect(templateDatabaseName(OWN_DIM, redated)).not.toBe(template);
  });
});
