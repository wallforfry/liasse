import { EMBEDDING_PROVIDERS } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import type { SettingsInput } from '@liasse/contract';
import { StartupError } from '../domain/errors.ts';
import { resolveSettings } from '../settings/resolve.ts';
import {
  SYNTHETIC_EMBEDDING_ENVIRONMENT,
  syntheticSettings,
} from '../testing/synthetic-settings.ts';
import { createEmbedder } from './create.ts';
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from './local.ts';
import { startModelProcess } from './model-process.ts';

const embeddingConfig = (embedding: SettingsInput['embedding'] = {}, dimension = 384) =>
  resolveSettings(syntheticSettings({ embedding }), {
    ...SYNTHETIC_EMBEDDING_ENVIRONMENT,
    dimension,
  }).embedding;

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const REMOTE = {
  model: 'synthetic-embedding-model',
  api_key: 'synthetic-embedding-key',
  base_url: 'http://models.example.test/v1',
} as const;

describe('createEmbedder', () => {
  it('builds the local embedder by default, which runs no model until it is used', async () => {
    const { embedder, close } = await createEmbedder(embeddingConfig());
    expect(embedder).toMatchObject({
      isLocal: true,
      model: DEFAULT_LOCAL_EMBEDDING_MODEL,
      dimension: 384,
      maxInputTokens: 504,
    });
    expect(embedder.countTokens).toBeTypeOf('function');
    await expect(close()).resolves.toBeUndefined();
  });

  it('ends the model process of the local embedder on close', async () => {
    const { embedder, close } = await createEmbedder(embeddingConfig(), {
      local: {
        loadModel: () =>
          Promise.resolve(
            startModelProcess({
              entry: new URL('./model-child.fixture.ts', import.meta.url),
              args: [],
              execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
            }),
          ),
      },
    });
    // The stand-in model answers this text with the id of its process.
    const [pid = Number.NaN] = (await embedder.countTokens?.(['pid'])) ?? [];
    expect(isRunning(pid)).toBe(true);
    await close();
    expect(isRunning(pid)).toBe(false);
  });

  it('checks the dimension of the local model at creation', async () => {
    const failure = createEmbedder(embeddingConfig({}, 768));
    await expect(failure).rejects.toBeInstanceOf(StartupError);
  });

  it.each(EMBEDDING_PROVIDERS.filter((provider) => provider !== 'local'))(
    'builds the provider embedder for %s',
    async (provider) => {
      const { embedder, close } = await createEmbedder(
        embeddingConfig({ ...REMOTE, provider }, 768),
        { resolveHost: () => Promise.resolve(['203.0.113.7']) },
      );
      expect(embedder).toMatchObject({
        isLocal: false,
        model: 'synthetic-embedding-model',
        dimension: 768,
      });
      expect(embedder.maxInputTokens).toBeUndefined();
      expect(embedder.countTokens).toBeUndefined();
      await expect(close()).resolves.toBeUndefined();
    },
  );
});
