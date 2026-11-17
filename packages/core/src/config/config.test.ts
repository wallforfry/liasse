import { describe, expect, it, vi } from 'vitest';
import { SYNTHETIC_ENV } from '../testing/synthetic-env.ts';
import { CONFIG_ENV_KEYS, ConfigError, loadConfig } from './index.ts';
import { REMOVED_ACCOUNT_ENV_KEYS, REMOVED_ENV_KEYS } from './removed.ts';

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
      embedding: { dimension: 384, cacheDir: '/data/models' },
      resources: { watchDir: undefined, workers: 2 },
      auth: {
        secret: SYNTHETIC_ENV.AUTH_SECRET,
        sessionTtlMs: 604_800_000,
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

  it('parses overrides, numbers and durations', () => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      HOST: '0.0.0.0',
      PORT: '9090',
      EMBEDDING_DIM: '768',
      EMBEDDING_CACHE_DIR: '/models',
      WORKERS: '4',
      WATCH_DIR: '/inbox',
      AUTH_SESSION_TTL: '12h',
    });
    expect(config.server).toEqual({
      host: '0.0.0.0',
      port: 9090,
      publicUrl: 'http://127.0.0.1:9090',
      trustedProxies: { subnets: [], cloudflare: false },
    });
    expect(config.embedding).toEqual({ dimension: 768, cacheDir: '/models' });
    expect(config.resources).toEqual({ watchDir: '/inbox', workers: 4 });
    expect(config.auth.sessionTtlMs).toBe(43_200_000);
  });

  it('refuses to start while a variable of the settings is set, naming each one', () => {
    const moved = Object.fromEntries(REMOVED_ENV_KEYS.map((key) => [key, 'synthetic-value']));
    expect(problemsOf({ ...SYNTHETIC_ENV, ...moved })).toEqual(
      REMOVED_ENV_KEYS.map(
        (key) =>
          `${key}: no longer read from the environment: the settings are stored in the ` +
          'database and changed with PUT /settings. Unset it.',
      ),
    );
    expect(REMOVED_ENV_KEYS).toHaveLength(23);
    expect(REMOVED_ENV_KEYS.filter((key) => CONFIG_ENV_KEYS.includes(key))).toEqual([]);
  });

  it('refuses to start while a variable of the first account is set, naming each one', () => {
    expect(
      problemsOf({
        ...SYNTHETIC_ENV,
        AUTH_BOOTSTRAP_EMAIL: 'owner@example.com',
        AUTH_BOOTSTRAP_PASSWORD: 'synthetic-owner-password',
      }),
    ).toEqual(
      ['AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD'].map(
        (key) =>
          `${key}: no longer read from the environment: the first account is created in the ` +
          'web UI, with the setup token the server prints at startup while no account ' +
          'exists. Unset it.',
      ),
    );
    expect(REMOVED_ACCOUNT_ENV_KEYS.filter((key) => CONFIG_ENV_KEYS.includes(key))).toEqual([]);
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

  it('lists every problem of every section in one error', () => {
    const problems = problemsOf({
      PORT: '99999',
      STORAGE_DRIVER: 'ftp',
      LLM_PROVIDER: 'ollama',
      EMBEDDING_DIM: '4096',
      WORKERS: '0',
      AUTH_SESSION_TTL: 'soon',
    });
    expect(problems.map((problem) => problem.split(':')[0])).toEqual([
      'LLM_PROVIDER',
      'PORT',
      'DATABASE_URL',
      'STORAGE_DRIVER',
      'EMBEDDING_DIM',
      'WORKERS',
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
    expect(message).toContain('LLM_API_KEY');
    expect(message).not.toContain('9f3a');
  });
});
