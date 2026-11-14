import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/load.ts';
import { StartupError } from '../domain/errors.ts';
import { EMBEDDING_PROVIDERS } from '../domain/enums.ts';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { createEmbedder } from './create.ts';
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from './local.ts';
import { startModelProcess } from './model-process.ts';

const embeddingConfig = (env: Readonly<Record<string, string>> = {}) =>
  loadConfig({ ...SYNTHETIC_ENV, ...env }).embedding;

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const REMOTE = {
  EMBEDDING_MODEL: 'synthetic-embedding-model',
  EMBEDDING_API_KEY: 'synthetic-embedding-key',
  EMBEDDING_BASE_URL: 'http://models.example.test/v1',
};

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
    const failure = createEmbedder(embeddingConfig({ EMBEDDING_DIM: '768' }));
    await expect(failure).rejects.toBeInstanceOf(StartupError);
  });

  it.each(EMBEDDING_PROVIDERS.filter((provider) => provider !== 'local'))(
    'builds the provider embedder for %s',
    async (provider) => {
      const { embedder, close } = await createEmbedder(
        embeddingConfig({ ...REMOTE, EMBEDDING_PROVIDER: provider, EMBEDDING_DIM: '768' }),
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
