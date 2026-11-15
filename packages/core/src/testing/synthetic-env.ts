// The smallest environment `loadConfig` accepts, with synthetic secrets.
export const SYNTHETIC_ENV = {
  DATABASE_URL: 'postgres://liasse:liasse@127.0.0.1:54329/liasse',
  LLM_PROVIDER: 'ollama',
  VISION_MODEL: 'vision-model',
  TEXT_MODEL: 'text-model',
  AUTH_SECRET: 'synthetic-auth-secret-0123456789abcdef',
  FILE_URL_SECRET: 'synthetic-file-url-secret-0123456789',
} as const;
