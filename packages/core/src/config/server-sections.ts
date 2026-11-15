import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  storageDriverSchema,
} from '@liasse/contract/domain';
import { z } from 'zod';
import { type CrossFieldProblem, duration, integer, reportProblems, text } from './fields.ts';
import { trustedProxies } from './trusted-proxies.ts';

// What clients are told to call: the origin signed file URLs start with. It is never read
// from a request, whose Host header belongs to the caller.
const isBareOrigin = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const { protocol, pathname, search, hash, username, password } = new URL(value);
  return (
    ['http:', 'https:'].includes(protocol) &&
    pathname === '/' &&
    [search, hash, username, password].every((part) => part === '')
  );
};

const publicUrl = z
  .string()
  .refine(
    isBareOrigin,
    'expected an origin such as https://liasse.example.com, without path, query or credentials',
  )
  .transform((value) => new URL(value).origin);

const WILDCARD_HOSTS: readonly string[] = ['0.0.0.0', '::'];

// A wildcard address is where the server listens, not where it is reached.
const defaultPublicUrl = (host: string, port: number): string => {
  const reachable = WILDCARD_HOSTS.includes(host) ? '127.0.0.1' : host;
  return `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${String(port)}`;
};

export const serverSection = z
  .object({
    HOST: text.default('127.0.0.1'),
    PORT: integer(1, 65_535).default(8080),
    PUBLIC_URL: publicUrl.optional(),
    TRUSTED_PROXIES: trustedProxies.prefault(''),
  })
  .transform((env) =>
    Object.freeze({
      host: env.HOST,
      port: env.PORT,
      publicUrl: env.PUBLIC_URL ?? defaultPublicUrl(env.HOST, env.PORT),
      trustedProxies: env.TRUSTED_PROXIES,
    }),
  );

export const databaseSection = z
  .object({
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/\S+$/, 'expected a postgres:// connection URL'),
  })
  .transform((env) => Object.freeze({ url: env.DATABASE_URL }));

// In bytes per second. An upload slower than this is given up; 64 KiB/s lets a 50 MiB
// file take a little under fourteen minutes.
const DEFAULT_S3_MIN_UPLOAD_RATE = 64 * 1024;
const MAX_S3_MIN_UPLOAD_RATE = 1024 * 1024 * 1024;

const storageFields = z.object({
  STORAGE_DRIVER: storageDriverSchema.default('fs'),
  STORAGE_PATH: text.default('/data/files'),
  S3_BUCKET: text.optional(),
  S3_REGION: text.optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: text.optional(),
  S3_SECRET_ACCESS_KEY: text.optional(),
  S3_REQUEST_TIMEOUT: duration.prefault('30s'),
  S3_MIN_UPLOAD_RATE: integer(1, MAX_S3_MIN_UPLOAD_RATE).default(DEFAULT_S3_MIN_UPLOAD_RATE),
});

const S3_REQUIRED_KEYS = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;

// The s3 driver signs its requests itself and reads no ambient credential (instance
// role, shared profile), hence the explicit key pair.
const missingS3Settings = (env: z.output<typeof storageFields>): readonly CrossFieldProblem[] =>
  S3_REQUIRED_KEYS.filter((key) => env[key] === undefined).map((key) => ({
    key,
    message: 'required when STORAGE_DRIVER=s3',
  }));

export const storageSection = storageFields.transform((env, ctx) => {
  if (env.STORAGE_DRIVER === 'fs') {
    return Object.freeze({ driver: env.STORAGE_DRIVER, path: env.STORAGE_PATH });
  }
  if (
    env.S3_BUCKET === undefined ||
    env.S3_ACCESS_KEY_ID === undefined ||
    env.S3_SECRET_ACCESS_KEY === undefined
  ) {
    reportProblems(ctx, missingS3Settings(env));
    return z.NEVER;
  }
  return Object.freeze({
    driver: env.STORAGE_DRIVER,
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    requestTimeoutMs: env.S3_REQUEST_TIMEOUT,
    minUploadBytesPerSecond: env.S3_MIN_UPLOAD_RATE,
  });
});

const MIN_SECRET_LENGTH = 32;

const secret = z
  .string()
  .min(MIN_SECRET_LENGTH, `expected at least ${String(MIN_SECRET_LENGTH)} characters`);

// Kept exactly as written: a password may start or end with a space.
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `expected at least ${String(MIN_PASSWORD_LENGTH)} characters`)
  .max(MAX_PASSWORD_LENGTH, `expected at most ${String(MAX_PASSWORD_LENGTH)} characters`);

const BOOTSTRAP_KEYS = ['AUTH_BOOTSTRAP_EMAIL', 'AUTH_BOOTSTRAP_PASSWORD'] as const;

export const authSection = z
  .object({
    AUTH_SECRET: secret,
    AUTH_SESSION_TTL: duration.prefault('7d'),
    AUTH_BOOTSTRAP_EMAIL: z.email('expected an email address').optional(),
    AUTH_BOOTSTRAP_PASSWORD: password.optional(),
    FILE_URL_SECRET: secret,
  })
  .transform((env, ctx) => {
    const { AUTH_BOOTSTRAP_EMAIL: email, AUTH_BOOTSTRAP_PASSWORD: bootstrapPassword } = env;
    // One without the other would create no user, silently.
    if ((email === undefined) !== (bootstrapPassword === undefined)) {
      reportProblems(
        ctx,
        BOOTSTRAP_KEYS.filter((key) => env[key] === undefined).map((key) => ({
          key,
          message: `required when ${BOOTSTRAP_KEYS.find((other) => other !== key) ?? ''} is set`,
        })),
      );
      return z.NEVER;
    }
    return Object.freeze({
      secret: env.AUTH_SECRET,
      sessionTtlMs: env.AUTH_SESSION_TTL,
      bootstrap:
        email === undefined || bootstrapPassword === undefined
          ? undefined
          : Object.freeze({ email, password: bootstrapPassword }),
      fileUrlSecret: env.FILE_URL_SECRET,
    });
  });
