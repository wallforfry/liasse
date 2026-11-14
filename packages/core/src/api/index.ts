// The schemas and types of requests and answers are in `@liasse/core/contract`.
export type { ApiContext } from './context.ts';
export { describeTypes } from './describe-types.ts';
export { openDocumentFile, type OpenedFile, removeDocument } from './document-file.ts';
export { API_ERROR_KINDS, ApiError, type ApiErrorKind } from './errors.ts';
export {
  type ApiFeatures,
  applyChange,
  correctDocument,
  type CorrectionOutcome,
  listChanges,
  listSubjects,
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
export { listDocuments } from './list-documents.ts';
export { listEntities } from './list-entities.ts';
export { queryDocuments } from './query-documents.ts';
export { searchDocuments } from './search-documents.ts';
export { readStats, type Stats } from './stats.ts';
export { uploadDocument, type UploadInput } from './upload-document.ts';
