import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { syntheticSettings } from '../testing/synthetic-settings.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { createSecretBox } from './secret-box.ts';
import { readSettings, StoredSettingsError, writeSettings } from './store.ts';

const LLM_KEY = 'synthetic-llm-key-41f0';
const EMBEDDING_KEY = 'synthetic-embedding-key-41f0';
const HINDSIGHT_KEY = 'synthetic-hindsight-key-41f0';

const WITH_KEYS = syntheticSettings({
  llm: { provider: 'anthropic', api_key: LLM_KEY },
  embedding: { provider: 'openai', model: 'embedding-model', api_key: EMBEDDING_KEY },
  hindsight: { url: 'http://127.0.0.1:8888', api_key: HINDSIGHT_KEY },
});

describe('the settings store', () => {
  let database: TestDatabase;
  const secrets = createSecretBox('synthetic-auth-secret-0123456789abcdef');
  const deps = () => ({ db: database.db, secrets });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterEach(async () => {
    await database.db.delete(settingsTable);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('holds nothing before the first save', async () => {
    expect(await readSettings(deps())).toBeUndefined();
  });

  it('reads back what it wrote, keys decrypted', async () => {
    const written = await writeSettings(deps(), { expectedVersion: 0, settings: WITH_KEYS });
    expect(written?.version).toBe(1);
    const read = await readSettings(deps());
    expect(read?.settings).toEqual(WITH_KEYS);
    expect(read?.version).toBe(1);
    expect(read?.updatedAt).toBeInstanceOf(Date);
  });

  it('stores no key in clear, in any column', async () => {
    await writeSettings(deps(), { expectedVersion: 0, settings: WITH_KEYS });
    const rows = await database.db.$client`SELECT row_to_json(settings)::text AS row FROM settings`;
    const stored = rows.map(({ row }) => String(row)).join('\n');
    expect(stored).toContain('anthropic');
    [LLM_KEY, EMBEDDING_KEY, HINDSIGHT_KEY].forEach((key) => {
      expect(stored).not.toContain(key);
    });
  });

  it('writes a version once: a save that read an older one changes nothing', async () => {
    await writeSettings(deps(), { expectedVersion: 0, settings: WITH_KEYS });
    const changed = syntheticSettings({ llm: { text_model: 'other-text-model' } });
    expect(await writeSettings(deps(), { expectedVersion: 0, settings: changed })).toBeUndefined();
    const second = await writeSettings(deps(), { expectedVersion: 1, settings: changed });
    expect(second?.version).toBe(2);
    expect(
      await writeSettings(deps(), { expectedVersion: 1, settings: WITH_KEYS }),
    ).toBeUndefined();
    expect((await readSettings(deps()))?.settings.llm.text_model).toBe('other-text-model');
  });

  it('lets one of two concurrent saves of a version win', async () => {
    await writeSettings(deps(), { expectedVersion: 0, settings: WITH_KEYS });
    const results = await Promise.all(
      ['first', 'second'].map((model) =>
        writeSettings(deps(), {
          expectedVersion: 1,
          settings: syntheticSettings({ llm: { text_model: model } }),
        }),
      ),
    );
    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
    expect((await readSettings(deps()))?.version).toBe(2);
  });

  it('refuses a row it cannot read as settings, without quoting it', async () => {
    await database.db.insert(settingsTable).values({ version: 1, document: { llm: 'broken' } });
    await expect(readSettings(deps())).rejects.toBeInstanceOf(StoredSettingsError);
  });
});
