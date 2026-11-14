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
export { type ClientOptions, DEFAULT_TIMEOUT_MS } from './transport.ts';
export type {
  DescribeTypesOptions,
  DocumentCorrection,
  DocumentList,
  DocumentPart,
  DocumentSummary,
  DocumentView,
  EntityListView,
  FeatureResult,
  GetDocumentOptions,
  Health,
  ListDocumentsOptions,
  ListEntitiesRequest,
  PrivateFilter,
  QueryResultEnvelope,
  SearchRequest,
  SearchResults,
  TypeList,
  UploadResult,
} from '@liasse/core/contract';
