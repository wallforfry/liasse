export const DOCUMENT_STATUSES = [
  'received',
  'extracted',
  'classified',
  'indexed',
  'failed',
  'needs_review',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_SOURCES = ['watch', 'api', 'mcp'] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const DOCUMENT_STATES = ['current', 'superseded', 'terminated'] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const TYPE_STATUSES = ['provisional', 'stable', 'merged'] as const;
export type TypeStatus = (typeof TYPE_STATUSES)[number];

export const CHANGE_KINDS = [
  'merge',
  'promote_field',
  'stabilize',
  'split',
  'rename',
  'merge_entity',
  'merge_subject',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STATUSES = ['pending', 'applied', 'rejected'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ENTITY_KINDS = ['org', 'person'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const KEY_DATE_KINDS = [
  'due',
  'expiry',
  'renewal',
  'notice_deadline',
  'effective',
  'event',
] as const;
export type KeyDateKind = (typeof KEY_DATE_KINDS)[number];

export const LINK_KINDS = [
  'supersedes',
  'amends',
  'terminates',
  'pays',
  'replies_to',
  'attachment_of',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const SUBJECT_KINDS = [
  'property',
  'vehicle',
  'contract',
  'employment',
  'account',
  'dependent',
] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const STORAGE_DRIVERS = ['fs', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export const LLM_PROVIDERS = [
  'anthropic',
  'openai',
  'mistral',
  'gemini',
  'ollama',
  'openai-compatible',
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const EMBEDDING_PROVIDERS = [
  'local',
  'openai',
  'mistral',
  'gemini',
  'ollama',
  'openai-compatible',
] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

// The languages type slugs and field names may be generated in. Each one needs its table
// of date words in the registry naming rules, which the compiler checks.
export const SCHEMA_LANGUAGES = ['en', 'fr', 'de', 'es', 'it'] as const;
export type SchemaLanguage = (typeof SCHEMA_LANGUAGES)[number];

export const AUTO_APPLY_MODES = ['none', 'safe', 'all'] as const;
export type AutoApplyMode = (typeof AUTO_APPLY_MODES)[number];

export const SUPPORTED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'message/rfc822',
] as const;
export type SupportedMime = (typeof SUPPORTED_MIMES)[number];
