import { MAX_EMBEDDING_DIM } from '@liasse/contract/domain';
import { z } from 'zod';
import { integer, text } from './fields.ts';

// The vector columns are typed by the first migration, before any settings can be read.
export const embeddingSection = z
  .object({
    EMBEDDING_DIM: integer(1, MAX_EMBEDDING_DIM).default(384),
    EMBEDDING_CACHE_DIR: text.default('/data/models'),
  })
  .transform((env) =>
    Object.freeze({ dimension: env.EMBEDDING_DIM, cacheDir: env.EMBEDDING_CACHE_DIR }),
  );

// What the process gives the pipeline: a folder to watch and its worker pool.
export const resourcesSection = z
  .object({
    WATCH_DIR: text.optional(),
    WORKERS: integer(1, 64).default(2),
  })
  .transform((env) => Object.freeze({ watchDir: env.WATCH_DIR, workers: env.WORKERS }));
