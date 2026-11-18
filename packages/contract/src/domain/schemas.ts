import { z } from 'zod';
import {
  AUTO_APPLY_MODES,
  CHANGE_KINDS,
  CHANGE_STATUSES,
  CONSOLIDATION_TRIGGERS,
  DOCUMENT_SOURCES,
  DOCUMENT_STATES,
  DOCUMENT_STATUSES,
  EMBEDDING_PROVIDERS,
  ENTITY_IDENTIFIER_TYPES,
  ENTITY_KINDS,
  ENTITY_MATCH_RULES,
  IMAP_SECURITY_MODES,
  GRAPH_EDGE_KINDS,
  GRAPH_NODE_KINDS,
  JOB_STATUSES,
  KEY_DATE_KINDS,
  LINK_KINDS,
  LLM_PROVIDERS,
  NOTICE_PERIOD_UNITS,
  PROCESSING_OUTCOMES,
  PROCESSING_STAGES,
  SCHEMA_LANGUAGES,
  SECRET_STATES,
  SOURCE_ERROR_KINDS,
  SOURCE_KINDS,
  GOOGLE_CONSENT_OUTCOMES,
  STORAGE_DRIVERS,
  SUBJECT_IDENTIFIER_TYPES,
  SUBJECT_KINDS,
  SUPPORTED_MIMES,
  TEXT_EXTRACTION_METHODS,
  TOMBSTONE_STATUS,
  TYPE_STATUSES,
} from './enums.ts';

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
// A tombstone is not a document: nothing that reads or filters documents names its status.
export const liveDocumentStatusSchema = documentStatusSchema.exclude([TOMBSTONE_STATUS]);
export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export const documentStateSchema = z.enum(DOCUMENT_STATES);
export const processingStageSchema = z.enum(PROCESSING_STAGES);
export const processingOutcomeSchema = z.enum(PROCESSING_OUTCOMES);
export const textExtractionMethodSchema = z.enum(TEXT_EXTRACTION_METHODS);
export const typeStatusSchema = z.enum(TYPE_STATUSES);
export const changeKindSchema = z.enum(CHANGE_KINDS);
export const changeStatusSchema = z.enum(CHANGE_STATUSES);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const consolidationTriggerSchema = z.enum(CONSOLIDATION_TRIGGERS);
export const entityKindSchema = z.enum(ENTITY_KINDS);
export const entityMatchRuleSchema = z.enum(ENTITY_MATCH_RULES);
export const entityIdentifierTypeSchema = z.enum(ENTITY_IDENTIFIER_TYPES);
export const keyDateKindSchema = z.enum(KEY_DATE_KINDS);
export const linkKindSchema = z.enum(LINK_KINDS);
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export const graphNodeKindSchema = z.enum(GRAPH_NODE_KINDS);
export const graphEdgeKindSchema = z.enum(GRAPH_EDGE_KINDS);
export const subjectIdentifierTypeSchema = z.enum(SUBJECT_IDENTIFIER_TYPES);
export const noticePeriodUnitSchema = z.enum(NOTICE_PERIOD_UNITS);
export const storageDriverSchema = z.enum(STORAGE_DRIVERS);
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export const embeddingProviderSchema = z.enum(EMBEDDING_PROVIDERS);
export const autoApplyModeSchema = z.enum(AUTO_APPLY_MODES);
export const schemaLanguageSchema = z.enum(SCHEMA_LANGUAGES);
export const supportedMimeSchema = z.enum(SUPPORTED_MIMES);
export const secretStateSchema = z.enum(SECRET_STATES);
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export const googleConsentOutcomeSchema = z.enum(GOOGLE_CONSENT_OUTCOMES);
export const sourceErrorKindSchema = z.enum(SOURCE_ERROR_KINDS);
export const imapSecuritySchema = z.enum(IMAP_SECURITY_MODES);
// A client sends the key in a header and appends its paths to the base URL, so
// credentials, a query string or a fragment in the URL cannot work; they would only end up
// in logs or in broken paths. The value is searched as written: a bare `?` or `#` leaves
// `search` and `hash` empty.
export const httpBaseUrlSchema = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const { protocol, username, password } = new URL(value);
  return (
    (protocol === 'http:' || protocol === 'https:') &&
    username === '' &&
    password === '' &&
    !/[?#]/.test(value)
  );
}, 'expected an http or https URL without credentials, query string or fragment');

// The description of every `include_private` flag of a read.
export const INCLUDE_PRIVATE_DESCRIPTION = 'Private documents are left out unless this is true.';
