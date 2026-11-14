import { fileURLToPath } from 'node:url';

// Where the tests of `pnpm test:models` keep the downloaded model.
export const MODEL_CACHE_DIR =
  process.env.EMBEDDING_CACHE_DIR ??
  fileURLToPath(new URL('../../node_modules/.cache/liasse-models', import.meta.url));
