// The schemas and types of requests and answers are in `@liasse/contract`.
export type { ApiContext } from './context.ts';
export { createType } from './create-type.ts';
export { describeTypes } from './describe-types.ts';
export { listDocumentEvents, type ListDocumentEventsOptions } from './document-events.ts';
export { openDocumentFile, type OpenedFile, removeDocument } from './document-file.ts';
export {
  API_ERROR_KINDS,
  ApiError,
  type ApiErrorKind,
  invalidRequest,
  notImplemented,
  toApiError,
} from './errors.ts';
export {
  type ApiFeatures,
  applyChange,
  correctDocument,
  CORRECTED_PARTS,
  type CorrectionOutcome,
  listChanges,
  listSubjects,
  listConsolidationRuns,
  requestConsolidationRun,
  upcoming,
} from './features.ts';
export {
  createFileUrls,
  FILE_URL_TTL_MS,
  type FileUrlGrant,
  type FileUrlOptions,
  type FileUrls,
} from './file-url.ts';
export { getDocument } from './get-document.ts';
export { getSubject, type KnowledgeFeatures, recall, timeline } from './knowledge.ts';
export { listDocuments } from './list-documents.ts';
export { listEntities } from './list-entities.ts';
export { queryDocuments } from './query-documents.ts';
export { reclassifyDocument } from './reclassify-document.ts';
export { searchDocuments } from './search-documents.ts';
export {
  checkSettingsDraft,
  type PreparedSettings,
  readSettingsState,
  saveSettings,
  type SettingsContext,
} from './settings.ts';
export { checkSetup, completeSetup, readSetupStatus, type SetupContext } from './setup.ts';
export { retryDocument } from './retry-document.ts';
export { readGraph } from './read-graph.ts';
export { readStats, type Stats } from './stats.ts';
export { uploadDocument, type UploadInput } from './upload-document.ts';
