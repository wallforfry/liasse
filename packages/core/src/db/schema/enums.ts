import {
  CHANGE_KINDS,
  CHANGE_STATUSES,
  DOCUMENT_SOURCES,
  DOCUMENT_STATES,
  DOCUMENT_STATUSES,
  ENTITY_KINDS,
  JOB_STATUSES,
  KEY_DATE_KINDS,
  LINK_KINDS,
  PROCESSING_OUTCOMES,
  PROCESSING_STAGES,
  SOURCE_KINDS,
  SUBJECT_KINDS,
  TYPE_STATUSES,
} from '@liasse/contract/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const documentStatus = pgEnum('document_status', DOCUMENT_STATUSES);
export const documentSource = pgEnum('document_source', DOCUMENT_SOURCES);
export const documentState = pgEnum('document_state', DOCUMENT_STATES);
export const typeStatus = pgEnum('type_status', TYPE_STATUSES);
export const changeKind = pgEnum('change_kind', CHANGE_KINDS);
export const changeStatus = pgEnum('change_status', CHANGE_STATUSES);
export const jobStatus = pgEnum('job_status', JOB_STATUSES);
export const entityKind = pgEnum('entity_kind', ENTITY_KINDS);
export const keyDateKind = pgEnum('key_date_kind', KEY_DATE_KINDS);
export const linkKind = pgEnum('link_kind', LINK_KINDS);
export const subjectKind = pgEnum('subject_kind', SUBJECT_KINDS);
export const processingStage = pgEnum('processing_stage', PROCESSING_STAGES);
export const processingOutcome = pgEnum('processing_outcome', PROCESSING_OUTCOMES);
export const sourceKind = pgEnum('source_kind', SOURCE_KINDS);
