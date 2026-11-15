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
      server: {
        host: '127.0.0.1',
        port: 8080,
        publicUrl: 'http://127.0.0.1:8080',
        trustedProxies: { subnets: [], cloudflare: false },
      },
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
        entitySimilarity: { attach: 1, arbitrate: 0.8 },
      },
      hindsight: undefined,
      auth: {
        secret: SYNTHETIC_ENV.AUTH_SECRET,
        sessionTtlMs: 604_800_000,
        bootstrap: undefined,
        fileUrlSecret: SYNTHETIC_ENV.FILE_URL_SECRET,
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
      AUTH_SESSION_TTL: '12h',
      AUTH_BOOTSTRAP_EMAIL: 'owner@example.com',
      AUTH_BOOTSTRAP_PASSWORD: 'synthetic-owner-password',
      LLM_TIMEOUT: '90s',
      EMBEDDING_TIMEOUT: '20s',
      HINDSIGHT_URL: 'http://127.0.0.1:8888',
    });
    expect(config.server).toEqual({
      host: '0.0.0.0',
      port: 9090,
      publicUrl: 'http://127.0.0.1:9090',
      trustedProxies: { subnets: [], cloudflare: false },
    });
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
    expect(config.auth.sessionTtlMs).toBe(43_200_000);
    expect(config.auth.bootstrap).toEqual({
      email: 'owner@example.com',
      password: 'synthetic-owner-password',
    });
    expect(config.hindsight).toEqual({
      url: 'http://127.0.0.1:8888',
      bank: 'documents',
      apiKey: undefined,
    });
  });

  it('reads the entity similarity thresholds', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      ENTITY_ATTACH_SIMILARITY: '0.97',
      ENTITY_ARBITRATION_SIMILARITY: '0.9',
    });
    expect(config.pipeline.entitySimilarity).toEqual({ attach: 0.97, arbitrate: 0.9 });
    expect(
      loadConfig({
        ...SYNTHETIC_ENV,
        ENTITY_ATTACH_SIMILARITY: '0.85',
        ENTITY_ARBITRATION_SIMILARITY: '0.85',
      }).pipeline.entitySimilarity,
    ).toEqual({ attach: 0.85, arbitrate: 0.85 });
  });

  it('refuses entity similarity thresholds outside 0 to 1', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, ENTITY_ATTACH_SIMILARITY: '1.5' })).toEqual([
      'ENTITY_ATTACH_SIMILARITY: Too big: expected number to be <=1',
    ]);
    expect(problemsOf({ ...SYNTHETIC_ENV, ENTITY_ARBITRATION_SIMILARITY: '-0.1' })).toEqual([
      'ENTITY_ARBITRATION_SIMILARITY: expected a decimal number such as 0.7',
    ]);
  });

  it('refuses an arbitration threshold above the attach threshold', () => {
    expect(
      problemsOf({
        ...SYNTHETIC_ENV,
        ENTITY_ATTACH_SIMILARITY: '0.9',
        ENTITY_ARBITRATION_SIMILARITY: '0.95',
      }),
    ).toEqual(['ENTITY_ARBITRATION_SIMILARITY: must not be above ENTITY_ATTACH_SIMILARITY']);
    expect(problemsOf({ ...SYNTHETIC_ENV, ENTITY_ATTACH_SIMILARITY: '0.7' })).toEqual([
      'ENTITY_ARBITRATION_SIMILARITY: must not be above ENTITY_ATTACH_SIMILARITY',
    ]);
  });

  it('needs both bootstrap variables or neither', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, AUTH_BOOTSTRAP_EMAIL: 'owner@example.com' })).toEqual([
      'AUTH_BOOTSTRAP_PASSWORD: required when AUTH_BOOTSTRAP_EMAIL is set',
    ]);
    expect(
      problemsOf({ ...SYNTHETIC_ENV, AUTH_BOOTSTRAP_PASSWORD: 'synthetic-owner-password' }),
    ).toEqual(['AUTH_BOOTSTRAP_EMAIL: required when AUTH_BOOTSTRAP_PASSWORD is set']);
  });

  it('refuses a bootstrap password shorter than 12 characters and a malformed email', () => {
    expect(
      problemsOf({
        ...SYNTHETIC_ENV,
        AUTH_BOOTSTRAP_EMAIL: 'not-an-email',
        AUTH_BOOTSTRAP_PASSWORD: 'short-pass',
      }),
    ).toEqual([
      'AUTH_BOOTSTRAP_EMAIL: expected an email address',
      'AUTH_BOOTSTRAP_PASSWORD: expected at least 12 characters',
    ]);
  });

  it('reads the input window of a remote embedding model, which has no default', () => {
    const remote = {
      ...SYNTHETIC_ENV,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
    };
    expect(loadConfig(remote).embedding).toMatchObject({ maxInputTokens: undefined });
    expect(loadConfig({ ...remote, EMBEDDING_MAX_INPUT_TOKENS: '512' }).embedding).toMatchObject({
      maxInputTokens: 512,
    });
    expect(problemsOf({ ...remote, EMBEDDING_MAX_INPUT_TOKENS: '63' })).toEqual([
      'EMBEDDING_MAX_INPUT_TOKENS: Too small: expected number to be >=64',
    ]);
  });

  it('refuses an input window for the local model, which knows its own', () => {
    expect(problemsOf({ ...SYNTHETIC_ENV, EMBEDDING_MAX_INPUT_TOKENS: '512' })).toEqual([
      'EMBEDDING_MAX_INPUT_TOKENS: only applies when EMBEDDING_PROVIDER is not local',
    ]);
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
    expect(Object.isFrozen(config.auth)).toBe(true);
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
    ['an empty query string', 'https://llm.example.com/secret-9f3a?'],
    ['a fragment', 'https://llm.example.com/v1#secret-9f3a'],
    ['an empty fragment', 'https://llm.example.com/secret-9f3a#'],
    ['another scheme', 'ftp://llm.example.com/secret-9f3a'],
  ])('rejects a model or Hindsight base URL with %s, without echoing it', (_case, url) => {
    const problems = problemsOf({
      ...SYNTHETIC_ENV,
      LLM_BASE_URL: url,
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'embedding-model',
      EMBEDDING_BASE_URL: url,
      HINDSIGHT_URL: url,
    });
    const rule = 'expected an http or https URL without credentials, query string or fragment';
    expect(problems).toEqual([
      `LLM_BASE_URL: ${rule}`,
      `EMBEDDING_BASE_URL: ${rule}`,
      `HINDSIGHT_URL: ${rule}`,
    ]);
  });

  it.each(['http://127.0.0.1:11434', 'https://llm.example.com/v1', 'https://llm.example.com/v1/'])(
    'accepts the model base URL %s',
    (url) => {
      expect(loadConfig({ ...SYNTHETIC_ENV, LLM_BASE_URL: url }).llm.baseUrl).toBe(url);
    },
  );

  it('reads the Hindsight bank and key, and ignores them without HINDSIGHT_URL', () => {
    const settings = { HINDSIGHT_BANK: 'household', HINDSIGHT_API_KEY: 'synthetic-hindsight-key' };
    expect(loadConfig({ ...SYNTHETIC_ENV, ...settings }).hindsight).toBeUndefined();
    expect(
      loadConfig({ ...SYNTHETIC_ENV, ...settings, HINDSIGHT_URL: 'https://hindsight.example.test' })
        .hindsight,
    ).toEqual({
      url: 'https://hindsight.example.test',
      bank: 'household',
      apiKey: 'synthetic-hindsight-key',
    });
  });

  it('lists every problem of every section in one error', () => {
    const problems = problemsOf({
      PORT: '99999',
      STORAGE_DRIVER: 'ftp',
      LLM_PROVIDER: 'ollama',
      EMBEDDING_DIM: '4096',
      CONFIDENCE_THRESHOLD: '1.5',
      AUTH_SESSION_TTL: 'soon',
    });
    expect(problems.map((problem) => problem.split(':')[0])).toEqual([
      'PORT',
      'DATABASE_URL',
      'STORAGE_DRIVER',
      'VISION_MODEL',
      'TEXT_MODEL',
      'EMBEDDING_DIM',
      'CONFIDENCE_THRESHOLD',
      'AUTH_SECRET',
      'AUTH_SESSION_TTL',
      'FILE_URL_SECRET',
    ]);
  });

  it('reads the trusted proxies and the cloudflare keyword', () => {
    expect(
      loadConfig({ ...SYNTHETIC_ENV, TRUSTED_PROXIES: ' 10.0.0.0/8, ,fd00::1,cloudflare' }).server
        .trustedProxies,
    ).toEqual({
      subnets: [
        { network: '10.0.0.0', prefix: 8, family: 'ipv4' },
        { network: 'fd00::1', prefix: 128, family: 'ipv6' },
      ],
      cloudflare: true,
    });
  });

  it('refuses a trusted proxy that is not an address, naming its position only', () => {
    expect(
      problemsOf({ ...SYNTHETIC_ENV, TRUSTED_PROXIES: '10.0.0.0/8,,proxy-9f3a,10.0.0.0/99' }),
    ).toEqual(
      [3, 4].map(
        (position) =>
          `TRUSTED_PROXIES: entry ${String(position)} is not an IP address, ` +
          'a CIDR range such as 10.0.0.0/8, or cloudflare',
      ),
    );
  });

  it('formats one readable message', () => {
    expect(() => loadConfig({ ...SYNTHETIC_ENV, PORT: 'http' })).toThrow(
      /^Invalid configuration:\n {2}- PORT: /,
    );
  });

  it('never echoes a rejected value', () => {
    const secrets = {
      DATABASE_URL: 'mysql://user:database-password-9f3a@db/liasse',
      AUTH_SECRET: 'short-9f3a',
      AUTH_BOOTSTRAP_PASSWORD: 'pw-9f3a',
      FILE_URL_SECRET: 'weak-secret-9f3a',
      LLM_API_KEY: 'llm-key-9f3a',
      LLM_BASE_URL: 'not a url 9f3a',
      S3_ENDPOINT: 'endpoint 9f3a',
      AUTH_SESSION_TTL: 'ttl-9f3a',
      WORKERS: 'workers-9f3a',
      STORAGE_DRIVER: 'driver-9f3a',
      TRUSTED_PROXIES: 'proxy-9f3a',
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
    expect(message).toContain('AUTH_SECRET');
    expect(message).toContain('AUTH_BOOTSTRAP_PASSWORD');
    expect(message).toContain('FILE_URL_SECRET');
    expect(message).toContain('TRUSTED_PROXIES');
    expect(message).not.toContain('9f3a');
  });
});
