import { settingsModelsRequestSchema, type SettingsModelsRequestInput } from '@liasse/contract';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { settings as settingsTable } from '../db/schema/settings.ts';
import { createSecretBox } from '../settings/secret-box.ts';
import { writeSettings } from '../settings/store.ts';
import { createFakeModelFactories } from '../testing/fake-model-factories.ts';
import { type StubServer, startStubServer } from '../testing/provider-stub-server.ts';
import {
  SYNTHETIC_EMBEDDING_ENVIRONMENT,
  syntheticSettings,
} from '../testing/synthetic-settings.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { ApiError } from './errors.ts';
import type { SettingsContext } from './settings.ts';
import { listSettingsModels } from './settings-models.ts';

const LLM_KEY = 'synthetic-llm-key-3e1d';
const EMBEDDING_KEY = 'synthetic-embedding-key-8b2f';
const NEW_KEY = 'synthetic-new-key-61c0';

describe('listSettingsModels', () => {
  let database: TestDatabase;
  let server: StubServer;
  let status = 200;
  const secrets = createSecretBox('synthetic-auth-secret-0123456789abcdef');

  const contextOf = (box = secrets): SettingsContext => ({
    db: database.db,
    secrets: box,
    embedding: SYNTHETIC_EMBEDDING_ENVIRONMENT,
    factories: createFakeModelFactories(),
    prepare: () => Promise.reject(new Error('a listing prepares nothing')),
  });

  const listing = (request: Partial<SettingsModelsRequestInput>, box = secrets) =>
    listSettingsModels(
      contextOf(box),
      settingsModelsRequestSchema.parse({
        section: 'llm',
        provider: 'openai-compatible',
        base_url: `${server.url}/v1`,
        ...request,
      }),
    );

  const authorization = (): string | undefined => {
    const header = server.requests.at(-1)?.headers.authorization;
    return typeof header === 'string' ? header : undefined;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    server = await startStubServer(() =>
      status === 200
        ? { body: { data: [{ id: 'model-a' }] } }
        : { status, body: { error: { type: 'invalid_request_error', code: 'invalid_api_key' } } },
    );
    await writeSettings(
      { db: database.db, secrets },
      {
        expectedVersion: 0,
        settings: syntheticSettings({
          llm: { provider: 'openai', api_key: LLM_KEY },
          embedding: { provider: 'ollama', model: 'embedding-model', api_key: EMBEDDING_KEY },
        }),
      },
    );
  });

  afterEach(() => {
    status = 200;
  });

  afterAll(async () => {
    await server.close();
    await database.dispose();
  });

  it('lists with the stored key of the section when the key is kept', async () => {
    await expect(listing({ api_key: { action: 'keep' } })).resolves.toEqual({
      status: 'ok',
      models: ['model-a'],
    });
    expect(authorization()).toBe(`Bearer ${LLM_KEY}`);

    await listing({ section: 'embedding', api_key: { action: 'keep' } });
    expect(authorization()).toBe(`Bearer ${EMBEDDING_KEY}`);
  });

  it('lists with a key the form replaced, or with none once it is cleared', async () => {
    await listing({ api_key: { action: 'replace', value: NEW_KEY } });
    expect(authorization()).toBe(`Bearer ${NEW_KEY}`);

    await listing({ api_key: { action: 'clear' } });
    expect(authorization()).toBeUndefined();
  });

  it('answers a refusal of the provider in words of its own, without the key', async () => {
    status = 401;

    const answer = await listing({});
    expect(answer).toMatchObject({ status: 'failed', code: 'unauthorized' });
    expect(JSON.stringify(answer)).not.toContain(LLM_KEY);
    expect(answer).toMatchObject({
      message:
        'The provider openai-compatible refused to list its models with HTTP 401 ' +
        '(invalid_request_error:invalid_api_key).',
    });
  });

  it('refuses to keep a key that the secret of this server does not open', async () => {
    const otherBox = createSecretBox('another-synthetic-secret-fedcba9876543210');
    const sent = server.requests.length;

    const error: unknown = await listing({}, otherBox).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_request' });
    expect(server.requests).toHaveLength(sent);
  });

  it('lists with no key while no settings were ever saved', async () => {
    await database.db.delete(settingsTable);
    try {
      await listing({});
      expect(authorization()).toBeUndefined();
    } finally {
      await writeSettings(
        { db: database.db, secrets },
        {
          expectedVersion: 0,
          settings: syntheticSettings({ llm: { provider: 'openai', api_key: LLM_KEY } }),
        },
      );
    }
  });
});

describe('settingsModelsRequestSchema', () => {
  it('asks openai-compatible for its base URL', () => {
    const parsed = settingsModelsRequestSchema.safeParse({
      section: 'llm',
      provider: 'openai-compatible',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['base_url']]);
  });

  it('lists nothing for the local embedder', () => {
    expect(
      settingsModelsRequestSchema.safeParse({ section: 'embedding', provider: 'local' }).success,
    ).toBe(false);
  });
});
