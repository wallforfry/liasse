import { describe, expect, it, vi } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { ConfigError, loadConfig } from './index.ts';

const problemsOf = (env: Readonly<Record<string, string | undefined>>): readonly string[] => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
};

describe('loadConfig', () => {
  it('applies the spec defaults', () => {
    expect(loadConfig(SYNTHETIC_ENV)).toEqual({
      server: { host: '127.0.0.1', port: 8080 },
      database: { url: SYNTHETIC_ENV.DATABASE_URL },
      storage: { driver: 'fs', path: '/data/files' },
      llm: {
        provider: 'ollama',
        apiKey: undefined,
        baseUrl: undefined,
        visionModel: 'vision-model',
        textModel: 'text-model',
      },
      embedding: { provider: 'local', model: undefined, dimension: 384 },
      pipeline: {
        watchDir: undefined,
        autoApply: 'safe',
        confidenceThreshold: 0.7,
        maxNewTypesPerDay: 5,
        schemaLanguage: 'en',
        workers: 2,
      },
      hindsight: undefined,
      auth: {
        apiTokens: ['synthetic-token-0001', 'synthetic-token-0002'],
        fileUrlSecret: SYNTHETIC_ENV.FILE_URL_SECRET,
        ui: undefined,
      },
    });
  });

  it('reads process.env by default', () => {
    Object.entries(SYNTHETIC_ENV).forEach(([key, value]) => {
      vi.stubEnv(key, value);
    });
    try {
      expect(loadConfig().database.url).toBe(SYNTHETIC_ENV.DATABASE_URL);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('defaults LLM_PROVIDER to anthropic, which needs an API key', () => {
    const { LLM_PROVIDER: _omitted, ...env } = SYNTHETIC_ENV;
    expect(problemsOf(env)).toEqual(['LLM_API_KEY: required when LLM_PROVIDER=anthropic']);
    expect(loadConfig({ ...env, LLM_API_KEY: 'synthetic-key' }).llm.provider).toBe('anthropic');
  });

  it('parses overrides, numbers and durations', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      HOST: '0.0.0.0',
      PORT: '9090',
      EMBEDDING_DIM: '768',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
      CONFIDENCE_THRESHOLD: '0.55',
      WORKERS: '4',
      WATCH_DIR: '/inbox',
      UI_PASSWORD: 'synthetic-ui-password',
      UI_SESSION_TTL: '12h',
      HINDSIGHT_URL: 'http://127.0.0.1:8888',
    });
    expect(config.server).toEqual({ host: '0.0.0.0', port: 9090 });
    expect(config.embedding).toEqual({
      provider: 'ollama',
      model: 'embedding-model',
      dimension: 768,
      apiKey: undefined,
      baseUrl: undefined,
    });
    expect(config.pipeline.confidenceThreshold).toBe(0.55);
    expect(config.pipeline.workers).toBe(4);
    expect(config.pipeline.watchDir).toBe('/inbox');
    expect(config.auth.ui).toEqual({
      password: 'synthetic-ui-password',
      sessionTtlMs: 43_200_000,
    });
    expect(config.hindsight).toEqual({
      url: 'http://127.0.0.1:8888',
      bank: 'documents',
      apiKey: undefined,
    });
  });

  it('defaults the UI session lifetime to seven days', () => {
    const config = loadConfig({ ...SYNTHETIC_ENV, UI_PASSWORD: 'synthetic-ui-password' });
    expect(config.auth.ui?.sessionTtlMs).toBe(604_800_000);
  });

  it('returns a frozen configuration', () => {
    const config = loadConfig(SYNTHETIC_ENV);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.server)).toBe(true);
    expect(Object.isFrozen(config.auth.apiTokens)).toBe(true);
  });

  it('accepts the s3 driver with a bucket', () => {
    const config = loadConfig({ ...SYNTHETIC_ENV, STORAGE_DRIVER: 's3', S3_BUCKET: 'liasse' });
    expect(config.storage).toEqual({
      driver: 's3',
      bucket: 'liasse',
      region: undefined,
      endpoint: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
    });
  });

  it('requires a bucket and paired credentials for the s3 driver', () => {
    expect(
      problemsOf({ ...SYNTHETIC_ENV, STORAGE_DRIVER: 's3', S3_ACCESS_KEY_ID: 'synthetic-id' }),
    ).toEqual([
      'S3_BUCKET: required when STORAGE_DRIVER=s3',
      'S3_SECRET_ACCESS_KEY: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
    ]);
  });

  it('requires a model, a key and a base URL for remote embedding providers', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, EMBEDDING_PROVIDER: 'openai' })).toEqual([
      'EMBEDDING_MODEL: required when EMBEDDING_PROVIDER=openai',
      'EMBEDDING_API_KEY: required when EMBEDDING_PROVIDER=openai',
    ]);
    expect(problemsOf({ ...SYNTHETIC_ENV, EMBEDDING_PROVIDER: 'openai-compatible' })).toEqual([
      'EMBEDDING_MODEL: required when EMBEDDING_PROVIDER=openai-compatible',
      'EMBEDDING_BASE_URL: required when EMBEDDING_PROVIDER=openai-compatible',
    ]);
  });

  it('requires a base URL for an openai-compatible LLM', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, LLM_PROVIDER: 'openai-compatible' })).toEqual([
      'LLM_BASE_URL: required when LLM_PROVIDER=openai-compatible',
    ]);
  });

  it('lists every problem of every section in one error', () => {
    const problems = problemsOf({
      PORT: '99999',
      STORAGE_DRIVER: 'ftp',
      LLM_PROVIDER: 'ollama',
      EMBEDDING_DIM: '4096',
      CONFIDENCE_THRESHOLD: '1.5',
      UI_SESSION_TTL: 'soon',
      API_TOKENS: ' , ',
    });
    expect(problems.map((problem) => problem.split(':')[0])).toEqual([
      'PORT',
      'DATABASE_URL',
      'STORAGE_DRIVER',
      'VISION_MODEL',
      'TEXT_MODEL',
      'EMBEDDING_DIM',
      'CONFIDENCE_THRESHOLD',
      'API_TOKENS',
      'UI_SESSION_TTL',
      'FILE_URL_SECRET',
    ]);
  });

  it('formats one readable message', () => {
    expect(() => loadConfig({ ...SYNTHETIC_ENV, PORT: 'http' })).toThrow(
      /^Invalid configuration:\n {2}- PORT: /,
    );
  });

  it('never echoes a rejected value', () => {
    const secrets = {
      DATABASE_URL: 'mysql://user:database-password-9f3a@db/liasse',
      API_TOKENS: 'short-9f3a',
      FILE_URL_SECRET: 'weak-secret-9f3a',
      LLM_API_KEY: 'llm-key-9f3a',
      LLM_BASE_URL: 'not a url 9f3a',
      S3_ENDPOINT: 'endpoint 9f3a',
      UI_SESSION_TTL: 'ttl-9f3a',
      WORKERS: 'workers-9f3a',
      STORAGE_DRIVER: 'driver-9f3a',
    };
    const message = (() => {
      try {
        loadConfig({ ...SYNTHETIC_ENV, ...secrets });
      } catch (error) {
        return error instanceof Error ? error.message : '';
      }
      return '';
    })();
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('API_TOKENS');
    expect(message).toContain('FILE_URL_SECRET');
    expect(message).not.toContain('9f3a');
  });
});
