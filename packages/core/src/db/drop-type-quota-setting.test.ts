import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { settingsDraftSchema } from '@liasse/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { migrate, MIGRATIONS_FOLDER } from './migrate.ts';
import { settings } from './schema/settings.ts';

const MIGRATION = '0024_drop_type_quota_setting';

const journalSchema = z.looseObject({ entries: z.array(z.looseObject({ tag: z.string() })) });

// The migrations as they were before this one, in a folder of their own.
const migrationsBefore = (tag: string): string => {
  const folder = mkdtempSync(join(tmpdir(), 'liasse-migrations-'));
  cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const path = join(folder, 'meta', '_journal.json');
  const journal = journalSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`No migration ${tag}`);
  writeFileSync(path, JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }));
  return folder;
};

const STORED_PIPELINE = {
  max_file_size: 52_428_800,
  auto_apply: 'safe',
  confidence_threshold: 0.7,
  schema_language: 'en',
  max_vision_pages: 100,
  entity_attach_similarity: 1,
  entity_arbitration_similarity: 0.8,
};

describe(`migration ${MIGRATION}`, () => {
  let database: TestDatabase;
  let folder: string;

  beforeAll(async () => {
    database = await createTestDatabase({ migrate: false });
    folder = migrationsBefore(MIGRATION);
    await migrate(database.url, { embeddingDim: 384, migrationsFolder: folder });
  });

  afterAll(async () => {
    rmSync(folder, { recursive: true, force: true });
    await database.dispose();
  });

  it('removes the daily quota of new types from saved settings, which then parse', async () => {
    const document = {
      llm: { provider: 'ollama', text_model: 'text-model', vision_model: 'vision-model' },
      pipeline: { ...STORED_PIPELINE, max_new_types_per_day: 5 },
    };
    await database.db.insert(settings).values({ version: 3, document, secrets: {} });
    expect(settingsDraftSchema.safeParse(document).success).toBe(false);

    await migrate(database.url, { embeddingDim: 384 });

    const [row] = await database.db.select().from(settings);
    expect(row).toMatchObject({
      version: 3,
      document: { llm: document.llm, pipeline: STORED_PIPELINE },
    });
    expect(settingsDraftSchema.safeParse(row?.document).success).toBe(true);
  });
});
