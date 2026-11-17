export type {
  ChangeDecisionResult,
  ChangeList,
  ChangeView,
  ConsolidationRun,
  ConsolidationRunList,
  ConsolidationRunView,
  CreatedType,
  CreateTypeRequest,
  DescribeTypesOptions,
  DocumentCorrection,
  DocumentEvent,
  DocumentEventDetails,
  DocumentEventList,
  DocumentList,
  DocumentPart,
  DocumentReclassification,
  DocumentReview,
  DocumentSummary,
  DocumentView,
  EntityListView,
  GetDocumentOptions,
  Graph,
  GraphEdge,
  GraphNode,
  GraphRequest,
  Health,
  ListDocumentsOptions,
  ListedSubject,
  ListEntitiesRequest,
  PrivateFilter,
  ReviewedValue,
  QueryResultEnvelope,
  SearchRequest,
  SearchResults,
  SubjectList,
  TypeList,
  TypeView,
  Upcoming,
  UpcomingDate,
  UploadResult,
} from '@liasse/contract';
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
