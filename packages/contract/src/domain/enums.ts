export const DOCUMENT_STATUSES = [
  'received',
  'extracted',
  'classified',
  'indexed',
  'failed',
  'needs_review',
  // A tombstone: the row keeps the hash of a deleted file and nothing of its content.
  'deleted',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const TOMBSTONE_STATUS = 'deleted' satisfies DocumentStatus;

/** False for the tombstone of a deleted document, which is not a document any more. */
export const isLiveStatus = (status: DocumentStatus): boolean => status !== TOMBSTONE_STATUS;

// A document still on its way through the pipeline.
export const IN_PROGRESS_STATUSES = [
  'received',
  'extracted',
  'classified',
] as const satisfies readonly DocumentStatus[];

// What `documents.error` says when the queue failed the job of a document for good: the
// worker stopped during the last attempt, the handler failed in a way it could not give
// a code for, or a re-extraction never succeeded.
export const DOCUMENT_JOB_FAILURE_CODES = {
  stale: 'processing_abandoned',
  error: 'processing_failed',
  reextraction: 'reextraction_failed',
} as const;

// How a document got its type: an offered type the model chose, a type it created, the
// closest candidate when a new type was refused or over quota, or no type at all.
export const CLASSIFICATION_OUTCOMES = ['existing', 'new', 'fallback', 'untyped'] as const;
export type ClassificationOutcome = (typeof CLASSIFICATION_OUTCOMES)[number];

// Why a settled document is flagged for review: its confidence is below the threshold,
// or unknown until the extraction its new type owes; it got the closest type, or none;
// its last re-extraction never succeeded. `rejected_values` tells that the model returned
// values that were dropped, which weighs on the confidence.
export const REVIEW_REASONS = [
  'low_confidence',
  'type_pending_extraction',
  'type_fallback',
  'type_untyped',
  'reextraction_failed',
  'rejected_values',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

// Where a value of a document is: the common core, or the fields of its type.
export const VALUE_SECTIONS = ['core', 'fields'] as const;
export type ValueSection = (typeof VALUE_SECTIONS)[number];

// Where the text of one page comes from: the file itself, or the vision model.
export const PAGE_TEXT_METHODS = ['native', 'vision'] as const;
export type PageTextMethod = (typeof PAGE_TEXT_METHODS)[number];

// For a whole document, `mixed` when its pages do not all share one method.
export const TEXT_EXTRACTION_METHODS = [...PAGE_TEXT_METHODS, 'mixed'] as const;
export type TextExtractionMethod = (typeof TEXT_EXTRACTION_METHODS)[number];

// The part of the processing an event of the log of a document is about. A
// re-indexing is an `indexing`; a re-extraction has its own stage, since it runs on a
// document already indexed.
export const PROCESSING_STAGES = [
  'text',
  'classification',
  'extraction',
  'reextraction',
  'indexing',
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

// `retrying`: the attempt failed and its job runs again. `failed`: it will not.
export const PROCESSING_OUTCOMES = ['succeeded', 'retrying', 'failed'] as const;
export type ProcessingOutcome = (typeof PROCESSING_OUTCOMES)[number];

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
  'remove_field',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_STATUSES = ['pending', 'applied', 'rejected'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ENTITY_KINDS = ['org', 'person'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

// The rule of entity resolution that attached a mention, in the order they are tried.
export const ENTITY_MATCH_RULES = [
  'identifier',
  'name',
  'alias',
  'similarity',
  'arbitration',
  'created',
] as const;
export type EntityMatchRule = (typeof ENTITY_MATCH_RULES)[number];

export const ENTITY_IDENTIFIER_TYPES = [
  'company_id',
  'vat_number',
  'customer_number',
  'iban',
  'card_number',
  'other',
] as const;
export type EntityIdentifierType = (typeof ENTITY_IDENTIFIER_TYPES)[number];

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

// What identifies a subject. A plate, a vehicle identification number, an IBAN and a card
// number name one subject whoever writes them. A contract number is scoped to its issuer,
// and an address is only as precise as the document that writes it.
export const SUBJECT_IDENTIFIER_TYPES = [
  'license_plate',
  'vin',
  'contract_number',
  'address',
  'iban',
  'card_number',
] as const;
export type SubjectIdentifierType = (typeof SUBJECT_IDENTIFIER_TYPES)[number];

export const NOTICE_PERIOD_UNITS = ['days', 'weeks', 'months'] as const;
export type NoticePeriodUnit = (typeof NOTICE_PERIOD_UNITS)[number];

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
