// The smallest environment `loadConfig` accepts, with synthetic secrets.
export const SYNTHETIC_ENV = {
  DATABASE_URL: 'postgres://liasse:liasse@127.0.0.1:54329/liasse',
  LLM_PROVIDER: 'ollama',
  VISION_MODEL: 'vision-model',
  TEXT_MODEL: 'text-model',
  API_TOKENS: 'synthetic-token-0001, synthetic-token-0002',
  FILE_URL_SECRET: 'synthetic-file-url-secret-0123456789',
} as const;
