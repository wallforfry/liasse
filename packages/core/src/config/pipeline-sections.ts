import { z } from 'zod';
import {
  DEFAULT_MAX_VISION_PAGES,
  ENTITY_ARBITRATION_SIMILARITY,
  ENTITY_ATTACH_SIMILARITY,
} from '../domain/limits.ts';
import { autoApplyModeSchema, schemaLanguageSchema } from '../domain/schemas.ts';
import { baseUrl, decimal, integer, reportProblems, text } from './fields.ts';

const MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = 50 * MEBIBYTE;
// An ingested file is hashed and sniffed in memory, and a Node Buffer stops at 2 GiB.
const MAX_FILE_SIZE_LIMIT = 2048 * MEBIBYTE - 1;

export const pipelineSection = z
  .object({
    WATCH_DIR: text.optional(),
    MAX_FILE_SIZE: integer(1, MAX_FILE_SIZE_LIMIT).default(DEFAULT_MAX_FILE_SIZE),
    AUTO_APPLY: autoApplyModeSchema.default('safe'),
    CONFIDENCE_THRESHOLD: decimal(0, 1).default(0.7),
    MAX_NEW_TYPES_PER_DAY: integer(0, 1000).default(5),
    SCHEMA_LANGUAGE: schemaLanguageSchema.default('en'),
    WORKERS: integer(1, 64).default(2),
    MAX_VISION_PAGES: integer(1, 10_000).default(DEFAULT_MAX_VISION_PAGES),
    ENTITY_ATTACH_SIMILARITY: decimal(0, 1).default(ENTITY_ATTACH_SIMILARITY),
    ENTITY_ARBITRATION_SIMILARITY: decimal(0, 1).default(ENTITY_ARBITRATION_SIMILARITY),
  })
  .transform((env, ctx) => {
    if (env.ENTITY_ARBITRATION_SIMILARITY > env.ENTITY_ATTACH_SIMILARITY) {
      reportProblems(ctx, [
        {
          key: 'ENTITY_ARBITRATION_SIMILARITY',
          message: 'must not be above ENTITY_ATTACH_SIMILARITY',
        },
      ]);
      return z.NEVER;
    }
    return Object.freeze({
      watchDir: env.WATCH_DIR,
      maxFileSize: env.MAX_FILE_SIZE,
      autoApply: env.AUTO_APPLY,
      confidenceThreshold: env.CONFIDENCE_THRESHOLD,
      maxNewTypesPerDay: env.MAX_NEW_TYPES_PER_DAY,
      schemaLanguage: env.SCHEMA_LANGUAGE,
      workers: env.WORKERS,
      maxVisionPages: env.MAX_VISION_PAGES,
      entitySimilarity: Object.freeze({
        attach: env.ENTITY_ATTACH_SIMILARITY,
        arbitrate: env.ENTITY_ARBITRATION_SIMILARITY,
      }),
    });
  });

export const hindsightSection = z
  .object({
    HINDSIGHT_URL: baseUrl.optional(),
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
