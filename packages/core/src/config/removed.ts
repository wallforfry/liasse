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
