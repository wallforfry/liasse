export type { ApiContext } from './context.ts';
export {
  describeTypes,
  type DescribeTypesOptions,
  describeTypesOptionsSchema,
  type TypeList,
  typeListSchema,
} from './describe-types.ts';
export { openDocumentFile, type OpenedFile, removeDocument } from './document-file.ts';
export { type DocumentSummary, documentSummarySchema } from './document-view.ts';
export { API_ERROR_KINDS, ApiError, type ApiErrorKind } from './errors.ts';
export {
  type ApiFeatures,
  applyChange,
  CHANGE_DECISIONS,
  type ChangeDecision,
  changeDecisionSchema,
  correctDocument,
  type CorrectionOutcome,
  type DocumentCorrection,
  documentCorrectionSchema,
  listChanges,
  type ListChangesOptions,
  listChangesOptionsSchema,
  listSubjects,
  type ListSubjectsOptions,
  listSubjectsOptionsSchema,
  upcoming,
  type UpcomingOptions,
  upcomingOptionsSchema,
} from './features.ts';
export {
  createFileUrls,
  FILE_URL_TTL_MS,
  type FileUrlGrant,
  type FileUrlOptions,
  type FileUrls,
} from './file-url.ts';
export {
  DEFAULT_PAGE_COUNT,
  DEFAULT_TEXT_LENGTH,
  DOCUMENT_PARTS,
  type DocumentPart,
  documentSchema,
  type DocumentView,
  getDocument,
  type GetDocumentOptions,
  getDocumentOptionsSchema,
  MAX_PAGE_COUNT,
  MAX_TEXT_LENGTH,
} from './get-document.ts';
export {
  DEFAULT_DOCUMENT_LIST_LIMIT,
  type DocumentList,
  documentListSchema,
  listDocuments,
  type ListDocumentsOptions,
  listDocumentsOptionsSchema,
  MAX_DOCUMENT_LIST_LIMIT,
  PRIVATE_FILTERS,
  type PrivateFilter,
} from './list-documents.ts';
export {
  type EntityListView,
  entityListSchema,
  listEntities,
  type ListEntitiesRequest,
  listEntitiesRequestSchema,
} from './list-entities.ts';
export { queryDocuments, queryResultSchema } from './query-documents.ts';
// What the routes of the bound knowledge features answer, as the knowledge layer defines it.
export { listSubjectsOutputSchema } from '../knowledge/list-subjects.ts';
export { upcomingOutputSchema } from '../knowledge/upcoming.ts';
export {
  searchDocuments,
  type SearchRequest,
  searchRequestSchema,
  type SearchResults,
  searchResultsSchema,
} from './search-documents.ts';
export { readStats, type Stats } from './stats.ts';
export {
  uploadDocument,
  type UploadInput,
  type UploadResult,
  uploadResultSchema,
} from './upload-document.ts';
