import { z } from 'zod';
import { autoApplyModeSchema, schemaLanguageSchema } from '../domain/schemas.ts';
import { decimal, integer, text } from './fields.ts';

export const pipelineSection = z
  .object({
    WATCH_DIR: text.optional(),
    AUTO_APPLY: autoApplyModeSchema.default('safe'),
    CONFIDENCE_THRESHOLD: decimal(0, 1).default(0.7),
    MAX_NEW_TYPES_PER_DAY: integer(0, 1000).default(5),
    SCHEMA_LANGUAGE: schemaLanguageSchema.default('en'),
    WORKERS: integer(1, 64).default(2),
  })
  .transform((env) =>
    Object.freeze({
      watchDir: env.WATCH_DIR,
      autoApply: env.AUTO_APPLY,
      confidenceThreshold: env.CONFIDENCE_THRESHOLD,
      maxNewTypesPerDay: env.MAX_NEW_TYPES_PER_DAY,
      schemaLanguage: env.SCHEMA_LANGUAGE,
      workers: env.WORKERS,
    }),
  );

export const hindsightSection = z
  .object({
    HINDSIGHT_URL: z.url().optional(),
    HINDSIGHT_BANK: text.default('documents'),
    HINDSIGHT_API_KEY: text.optional(),
  })
  .transform((env) =>
    env.HINDSIGHT_URL === undefined
      ? undefined
      : Object.freeze({
          url: env.HINDSIGHT_URL,
          bank: env.HINDSIGHT_BANK,
          apiKey: env.HINDSIGHT_API_KEY,
        }),
  );
