import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { installedEmbeddingDimensions } from '../db/embedding-dimension.ts';
import { MIGRATIONS_FOLDER } from '../db/migrate.ts';
import { readMigrationFiles } from '../db/migration-files.ts';
import {
  createTestDatabase,
  type TestDatabase,
  type TestDatabaseOptions,
} from './test-database.ts';
import { databaseExists, withAdmin } from './test-server.ts';
import { dropIdleTemplate, privateTemplateName, templateDatabaseName } from './test-template.ts';

// No other test file uses this dimension, and the template name is this run's own: another
// suite on the same server running this file at the same time builds and drops another one.
const OWN_DIM = 13;
const template = privateTemplateName(OWN_DIM);
const ownCopy = (): Promise<TestDatabase> =>
  createTestDatabase({ embeddingDim: OWN_DIM, template });

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
  const settled = await Promise.allSettled(Array.from({ length: count }, ownCopy));
  const created = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure === undefined) return created;
  await disposeAll(created);
  throw failure.reason;
};

describe('createTestDatabase from a template', () => {
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
    const first = await ownCopy();
    try {
      await first.db.execute(sql`CREATE TABLE only_in_first (id int)`);
      const second = await ownCopy();
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
    await disposeAll([await ownCopy()]);
    expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(true);
    expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(false);
    const database = await ownCopy();
    try {
      expect(await installedDimensions(database)).toEqual([OWN_DIM]);
    } finally {
      await database.dispose();
    }
  });

  // The lock taken here is the one another suite holds while it copies the shared template.
  it('drops and builds its template again while another run copies the shared one', async () => {
    await withAdmin(async (otherRun) => {
      await otherRun`SELECT pg_advisory_lock_shared(hashtext(${templateDatabaseName(OWN_DIM)}))`;
      await disposeAll([await ownCopy()]);
      expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(true);
      await disposeAll([await ownCopy()]);
    });
    expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
  });

  it('leaves a template alone while a copy holds its lock', async () => {
    await disposeAll([await ownCopy()]);
    await withAdmin(async (copying) => {
      await copying`SELECT pg_advisory_lock_shared(hashtext(${template}))`;
      expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(false);
    });
    expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
  });

  it('leaves a template alone while a copy of it remains, and drops it once none does', async () => {
    const copy = await ownCopy();
    try {
      expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(false);
      expect(await withAdmin((admin) => databaseExists(admin, template))).toBe(true);
    } finally {
      await copy.dispose();
    }
    expect(await withAdmin((admin) => dropIdleTemplate(admin, template))).toBe(true);
  });
});

// Checked by `pnpm typecheck`, which compiles the test files.
describe('TestDatabaseOptions', () => {
  it('takes a template only for a database it migrates', () => {
    expectTypeOf({ template }).toExtend<TestDatabaseOptions>();
    expectTypeOf({ migrate: true as const, template }).toExtend<TestDatabaseOptions>();
    expectTypeOf({ migrate: false as const }).toExtend<TestDatabaseOptions>();
    expectTypeOf({ migrate: false as const, template }).not.toExtend<TestDatabaseOptions>();
  });
});

describe('templateDatabaseName', () => {
  const shared = templateDatabaseName(OWN_DIM);
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

    expect(templateDatabaseName(OWN_DIM, unchanged)).toBe(shared);
    expect(templateDatabaseName(OWN_DIM, changed)).not.toBe(shared);
    expect(templateDatabaseName(OWN_DIM + 1, unchanged)).not.toBe(shared);
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

    expect(templateDatabaseName(OWN_DIM, redated)).not.toBe(shared);
  });
});
