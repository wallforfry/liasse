import { z } from 'zod';
import { storageDriverSchema } from '../domain/schemas.ts';
import { type CrossFieldProblem, duration, integer, list, reportProblems, text } from './fields.ts';

export const serverSection = z
  .object({
    HOST: text.default('127.0.0.1'),
    PORT: integer(1, 65_535).default(8080),
  })
  .transform((env) => Object.freeze({ host: env.HOST, port: env.PORT }));

export const databaseSection = z
  .object({
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/\S+$/, 'expected a postgres:// connection URL'),
  })
  .transform((env) => Object.freeze({ url: env.DATABASE_URL }));

const storageFields = z.object({
  STORAGE_DRIVER: storageDriverSchema.default('fs'),
  STORAGE_PATH: text.default('/data/files'),
  S3_BUCKET: text.optional(),
  S3_REGION: text.optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: text.optional(),
  S3_SECRET_ACCESS_KEY: text.optional(),
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
  });
});

const MIN_API_TOKEN_LENGTH = 16;
const MIN_FILE_URL_SECRET_LENGTH = 32;

export const authSection = z
  .object({
    API_TOKENS: list.pipe(
      z
        .array(
          z
            .string()
            .min(
              MIN_API_TOKEN_LENGTH,
              `each token needs at least ${String(MIN_API_TOKEN_LENGTH)} characters`,
            ),
        )
        .min(1, 'expected at least one token')
        .readonly(),
    ),
    UI_PASSWORD: z.string().min(1).optional(),
    UI_SESSION_TTL: duration.prefault('7d'),
    FILE_URL_SECRET: z
      .string()
      .min(
        MIN_FILE_URL_SECRET_LENGTH,
        `expected at least ${String(MIN_FILE_URL_SECRET_LENGTH)} characters`,
      ),
  })
  .transform((env) =>
    Object.freeze({
      apiTokens: env.API_TOKENS,
      fileUrlSecret: env.FILE_URL_SECRET,
      ui:
        env.UI_PASSWORD === undefined
          ? undefined
          : Object.freeze({ password: env.UI_PASSWORD, sessionTtlMs: env.UI_SESSION_TTL }),
    }),
  );
