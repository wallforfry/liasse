import { z } from 'zod';
import {
  AUTO_APPLY_MODES,
  CHANGE_KINDS,
  CHANGE_STATUSES,
  DOCUMENT_SOURCES,
  DOCUMENT_STATES,
  DOCUMENT_STATUSES,
  EMBEDDING_PROVIDERS,
  ENTITY_IDENTIFIER_TYPES,
  ENTITY_KINDS,
  ENTITY_MATCH_RULES,
  JOB_STATUSES,
  KEY_DATE_KINDS,
  LINK_KINDS,
  LLM_PROVIDERS,
  SCHEMA_LANGUAGES,
  STORAGE_DRIVERS,
  SUBJECT_KINDS,
  SUPPORTED_MIMES,
  TOMBSTONE_STATUS,
  TYPE_STATUSES,
} from './enums.ts';

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
// A tombstone is not a document: nothing that reads or filters documents names its status.
export const liveDocumentStatusSchema = documentStatusSchema.exclude([TOMBSTONE_STATUS]);
export const documentSourceSchema = z.enum(DOCUMENT_SOURCES);
export const documentStateSchema = z.enum(DOCUMENT_STATES);
export const typeStatusSchema = z.enum(TYPE_STATUSES);
export const changeKindSchema = z.enum(CHANGE_KINDS);
export const changeStatusSchema = z.enum(CHANGE_STATUSES);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const entityKindSchema = z.enum(ENTITY_KINDS);
export const entityMatchRuleSchema = z.enum(ENTITY_MATCH_RULES);
export const entityIdentifierTypeSchema = z.enum(ENTITY_IDENTIFIER_TYPES);
export const keyDateKindSchema = z.enum(KEY_DATE_KINDS);
export const linkKindSchema = z.enum(LINK_KINDS);
export const subjectKindSchema = z.enum(SUBJECT_KINDS);
export const storageDriverSchema = z.enum(STORAGE_DRIVERS);
export const llmProviderSchema = z.enum(LLM_PROVIDERS);
export const embeddingProviderSchema = z.enum(EMBEDDING_PROVIDERS);
export const autoApplyModeSchema = z.enum(AUTO_APPLY_MODES);
export const schemaLanguageSchema = z.enum(SCHEMA_LANGUAGES);
export const supportedMimeSchema = z.enum(SUPPORTED_MIMES);
