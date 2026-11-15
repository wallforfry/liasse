import packageJson from '../package.json' with { type: 'json' };

export const SDK_VERSION: string = packageJson.version;

export {
  type ChangeDecisionRequest,
  createLiasseClient,
  type LiasseClient,
  type ListChangesRequest,
  type ListSubjectsRequest,
  type OpenApiDocument,
  type QueryRequest,
  type UpcomingRequest,
} from './client.ts';
export { LiasseApiError, LiasseResponseError } from './errors.ts';
export type { DownloadedFile, UploadInput } from './files.ts';
export { type ClientOptions, DEFAULT_TIMEOUT_MS, type SessionCredentials } from './transport.ts';
export type {
  ChangeDecisionResult,
  ChangeList,
  ChangeView,
  DescribeTypesOptions,
  DocumentCorrection,
  DocumentList,
  DocumentPart,
  DocumentSummary,
  DocumentView,
  EntityListView,
  GetDocumentOptions,
  Health,
  ListDocumentsOptions,
  ListEntitiesRequest,
  ListedSubject,
  PrivateFilter,
  QueryResultEnvelope,
  SearchRequest,
  SearchResults,
  SubjectList,
  TypeList,
  Upcoming,
  UpcomingDate,
  UploadResult,
} from '@liasse/core/contract';
