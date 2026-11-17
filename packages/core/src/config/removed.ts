// The variables of the settings now stored in the database. One still set would be
// ignored, and the server would run with other models than the operator believes.
export const REMOVED_ENV_KEYS: readonly string[] = [
  'LLM_PROVIDER',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_TIMEOUT',
  'TEXT_MODEL',
  'VISION_MODEL',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_MODEL',
  'EMBEDDING_API_KEY',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_TIMEOUT',
  'EMBEDDING_MAX_INPUT_TOKENS',
  'MAX_FILE_SIZE',
  'AUTO_APPLY',
  'CONFIDENCE_THRESHOLD',
  'MAX_NEW_TYPES_PER_DAY',
  'SCHEMA_LANGUAGE',
  'MAX_VISION_PAGES',
  'ENTITY_ATTACH_SIMILARITY',
  'ENTITY_ARBITRATION_SIMILARITY',
  'HINDSIGHT_URL',
  'HINDSIGHT_BANK',
  'HINDSIGHT_API_KEY',
];

export const REMOVED_ENV_MESSAGE =
  'no longer read from the environment: the settings are stored in the database and ' +
  'changed with PUT /settings. Unset it.';

// The first account is created by the onboarding of the web UI, with the setup token the
// server prints at startup. One still set would create nothing, silently.
export const REMOVED_ACCOUNT_ENV_KEYS: readonly string[] = [
  'AUTH_BOOTSTRAP_EMAIL',
  'AUTH_BOOTSTRAP_PASSWORD',
];

export const REMOVED_ACCOUNT_ENV_MESSAGE =
  'no longer read from the environment: the first account is created in the web UI, with ' +
  'the setup token the server prints at startup while no account exists. Unset it.';

/** Each removed variable, with what the operator is told when it is still set. */
export const REMOVED_ENV: ReadonlyMap<string, string> = new Map([
  ...REMOVED_ENV_KEYS.map((key): [string, string] => [key, REMOVED_ENV_MESSAGE]),
  ...REMOVED_ACCOUNT_ENV_KEYS.map((key): [string, string] => [key, REMOVED_ACCOUNT_ENV_MESSAGE]),
]);
