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
        timeoutMs: 300_000,
      },
      embedding: {
        provider: 'local',
        model: undefined,
        dimension: 384,
        cacheDir: '/data/models',
      },
      pipeline: {
        watchDir: undefined,
        maxFileSize: 52_428_800,
        autoApply: 'safe',
        confidenceThreshold: 0.7,
        maxNewTypesPerDay: 5,
        schemaLanguage: 'en',
        workers: 2,
        maxVisionPages: 100,
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
      MAX_VISION_PAGES: '25',
      WATCH_DIR: '/inbox',
      UI_PASSWORD: 'synthetic-ui-password',
      UI_SESSION_TTL: '12h',
      LLM_TIMEOUT: '90s',
      EMBEDDING_TIMEOUT: '20s',
      HINDSIGHT_URL: 'http://127.0.0.1:8888',
    });
    expect(config.server).toEqual({ host: '0.0.0.0', port: 9090 });
    expect(config.embedding).toEqual({
      provider: 'ollama',
      model: 'embedding-model',
      dimension: 768,
      apiKey: undefined,
      baseUrl: undefined,
      timeoutMs: 20_000,
    });
    expect(config.llm.timeoutMs).toBe(90_000);
    expect(config.pipeline.confidenceThreshold).toBe(0.55);
    expect(config.pipeline.workers).toBe(4);
    expect(config.pipeline.maxVisionPages).toBe(25);
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

  it('defaults the embedding request timeout to one minute', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
    });
    expect(config.embedding).toMatchObject({ timeoutMs: 60_000 });
  });

  it('rejects a model timeout that is not a duration', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, LLM_TIMEOUT: '0s', EMBEDDING_TIMEOUT: 'fast' })).toEqual([
      'LLM_TIMEOUT: expected a duration such as 30m, 12h or 7d',
      'EMBEDDING_TIMEOUT: expected a duration such as 30m, 12h or 7d',
    ]);
  });

  it('returns a frozen configuration', () => {
    const config = loadConfig(SYNTHETIC_ENV);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.server)).toBe(true);
    expect(Object.isFrozen(config.auth.apiTokens)).toBe(true);
  });

  it('accepts the s3 driver with a bucket and a key pair', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'liasse',
      S3_ACCESS_KEY_ID: 'synthetic-id',
      S3_SECRET_ACCESS_KEY: 'synthetic-secret',
    });
    expect(config.storage).toEqual({
      driver: 's3',
      bucket: 'liasse',
      region: undefined,
      endpoint: undefined,
      accessKeyId: 'synthetic-id',
      secretAccessKey: 'synthetic-secret',
      requestTimeoutMs: 30_000,
      minUploadBytesPerSecond: 65_536,
    });
  });

  it('reads the deadline and the minimum upload rate of the s3 driver', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'liasse',
      S3_ACCESS_KEY_ID: 'synthetic-id',
      S3_SECRET_ACCESS_KEY: 'synthetic-secret',
      S3_REQUEST_TIMEOUT: '2m',
      S3_MIN_UPLOAD_RATE: '8192',
    });
    expect(config.storage).toMatchObject({
      requestTimeoutMs: 120_000,
      minUploadBytesPerSecond: 8192,
    });
    expect(problemsOf({ ...SYNTHETIC_ENV, S3_MIN_UPLOAD_RATE: '0' })).toHaveLength(1);
  });

  it('requires a bucket and a key pair for the s3 driver', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, STORAGE_DRIVER: 's3' })).toEqual([
      'S3_BUCKET: required when STORAGE_DRIVER=s3',
      'S3_ACCESS_KEY_ID: required when STORAGE_DRIVER=s3',
      'S3_SECRET_ACCESS_KEY: required when STORAGE_DRIVER=s3',
    ]);
    expect(
      problemsOf({
        ...SYNTHETIC_ENV,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'liasse',
        S3_ACCESS_KEY_ID: 'synthetic-id',
      }),
    ).toEqual(['S3_SECRET_ACCESS_KEY: required when STORAGE_DRIVER=s3']);
  });

  it('caps an ingested file at 50 MB unless MAX_FILE_SIZE says otherwise', () => {
    expect(loadConfig(SYNTHETIC_ENV).pipeline.maxFileSize).toBe(52_428_800);
    expect(loadConfig({ ...SYNTHETIC_ENV, MAX_FILE_SIZE: '1024' }).pipeline.maxFileSize).toBe(1024);
    expect(problemsOf({ ...SYNTHETIC_ENV, MAX_FILE_SIZE: '0' })).toHaveLength(1);
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

  it.each([
    ['credentials', 'https://operator:secret-9f3a@llm.example.com/v1'],
    ['a user name', 'https://secret-9f3a@llm.example.com/v1'],
    ['a password', 'https://:secret-9f3a@llm.example.com/v1'],
    ['a query string', 'https://llm.example.com/v1?api-key=secret-9f3a'],
    ['another scheme', 'ftp://llm.example.com/secret-9f3a'],
  ])('rejects a model base URL with %s, without echoing it', (_case, url) => {
    const problems = problemsOf({
      ...SYNTHETIC_ENV,
      LLM_BASE_URL: url,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
      EMBEDDING_BASE_URL: url,
    });
    expect(problems).toEqual([
      'LLM_BASE_URL: expected an http or https URL without credentials or query string',
      'EMBEDDING_BASE_URL: expected an http or https URL without credentials or query string',
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
