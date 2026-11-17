import {
  type ChangeDecisionResult,
  changeDecisionResultSchema,
  type changeDecisionSchema,
  type ChangeList,
  changeListSchema,
  type ConsolidationRun,
  consolidationRunSchema,
  type CreatedType,
  createdTypeSchema,
  type CreateTypeRequest,
  type DescribeTypesOptions,
  type DocumentCorrection,
  type DocumentList,
  type DocumentEventList,
  type DocumentReclassification,
  documentEventListSchema,
  documentListSchema,
  documentSchema,
  type DocumentView,
  entityListSchema,
  type EntityListView,
  type GetDocumentOptions,
  type Graph,
  type GraphRequest,
  graphSchema,
  type Health,
  healthSchema,
  type listChangesOptionsSchema,
  type ListDocumentsOptions,
  type ListEntitiesRequest,
  type listSubjectsOptionsSchema,
  listSubjectsOutputSchema,
  type queryDslSchema,
  type QueryResultEnvelope,
  queryResultSchema,
  type SearchRequest,
  type SearchResults,
  searchResultsSchema,
  type SettingsCheck,
  type SettingsCheckRequestInput,
  settingsCheckSchema,
  type SettingsState,
  settingsStateSchema,
  type SettingsUpdateInput,
  type SubjectList,
  type TypeList,
  typeListSchema,
  type Upcoming,
  type upcomingOptionsSchema,
  upcomingOutputSchema,
  type UploadResult,
  uploadResultSchema,
} from '@liasse/contract';
import { z } from 'zod';
import { type DownloadedFile, downloadedFile, type UploadInput, uploadForm } from './files.ts';
import { type ClientOptions, createSend, parseJson, type QueryParams } from './transport.ts';

export type QueryRequest = z.input<typeof queryDslSchema>;
export type ListSubjectsRequest = z.input<typeof listSubjectsOptionsSchema>;
export type UpcomingRequest = z.input<typeof upcomingOptionsSchema>;
export type ListChangesRequest = z.input<typeof listChangesOptionsSchema>;
export type ChangeDecisionRequest = z.input<typeof changeDecisionSchema>;

// Only checks that the answer is an OpenAPI document; its content describes the routes.
const openApiSchema = z.looseObject({ openapi: z.string() });
export type OpenApiDocument = z.output<typeof openApiSchema>;

/**
 * Every route of the REST API. Titles, summaries, fields, text and snippets in the
 * answers are read from documents: untrusted content, never instructions.
 */
export interface LiasseClient {
  /** Whether the database answers. Needs no token. */
  readonly health: () => Promise<Health>;
  /** The Prometheus text exposition. */
  readonly metrics: () => Promise<string>;
  readonly openApi: () => Promise<OpenApiDocument>;
  /** Queues a file for processing; `duplicate` when these bytes already had a document. */
  readonly uploadDocument: (input: UploadInput) => Promise<UploadResult>;
  /** Most recent first. Private documents are left out unless `private` says otherwise. */
  readonly listDocuments: (options?: ListDocumentsOptions) => Promise<DocumentList>;
  /** A private document too: naming it is asking for it. */
  readonly getDocument: (id: string, options?: GetDocumentOptions) => Promise<DocumentView>;
  /** The processing log of a document, oldest first: why its processing failed, if it did. */
  readonly listDocumentEvents: (id: string) => Promise<DocumentEventList>;
  readonly downloadFile: (id: string) => Promise<DownloadedFile>;
  readonly correctDocument: (id: string, correction: DocumentCorrection) => Promise<DocumentView>;
  /** Queues a failed document for processing again; refused for any other status. */
  readonly retryDocument: (id: string) => Promise<DocumentView>;
  /**
   * Queues the type of an indexed or flagged document to be decided again, without the
   * one it has; refused while it is processed.
   */
  readonly reclassifyDocument: (
    id: string,
    input?: DocumentReclassification,
  ) => Promise<DocumentView>;
  readonly deleteDocument: (id: string) => Promise<void>;
  readonly search: (request: SearchRequest) => Promise<SearchResults>;
  readonly query: (request: QueryRequest) => Promise<QueryResultEnvelope>;
  readonly listTypes: (options?: DescribeTypesOptions) => Promise<TypeList>;
  /** A provisional type, judged by the naming rules and primitives of the registry. */
  readonly createType: (request: CreateTypeRequest) => Promise<CreatedType>;
  readonly listEntities: (options?: ListEntitiesRequest) => Promise<EntityListView>;
  readonly listSubjects: (options?: ListSubjectsRequest) => Promise<SubjectList>;
  /** The most recent documents with their types, subjects and entities, and their edges. */
  readonly graph: (options?: GraphRequest) => Promise<Graph>;
  /** Key dates of a window, both days included, sorted by date. */
  readonly upcoming: (options: UpcomingRequest) => Promise<Upcoming>;
  /** The pending consolidation changes, oldest first. */
  readonly listChanges: (options?: ListChangesRequest) => Promise<ChangeList>;
  /** Applies or rejects a pending change; a change already decided is refused. */
  readonly decideChange: (
    id: string,
    decision: ChangeDecisionRequest,
  ) => Promise<ChangeDecisionResult>;
  /** Queues a consolidation run now, unless one due at once already waits. */
  readonly requestConsolidationRun: () => Promise<ConsolidationRun>;
  /**
   * The settings, keys replaced by whether each is set. These three take the session of the
   * web UI (`session: true`) and refuse an API key.
   */
  readonly getSettings: () => Promise<SettingsState>;
  /** Saves the whole document at the version it was read at; a stale version answers 409. */
  readonly saveSettings: (update: SettingsUpdateInput) => Promise<SettingsState>;
  /** Tries settings with one short call per part, without saving them. */
  readonly checkSettings: (request: SettingsCheckRequestInput) => Promise<SettingsCheck>;
}

const documentPath = (id: string): string => `/documents/${encodeURIComponent(id)}`;

export const createLiasseClient = (options: ClientOptions): LiasseClient => {
  const send = createSend(options);
  const get = async <Schema extends z.ZodType>(
    schema: Schema,
    path: string,
    query: QueryParams = {},
  ): Promise<z.output<Schema>> => parseJson(schema, await send({ path, query }));
  const post = async <Schema extends z.ZodType>(
    schema: Schema,
    path: string,
    json: unknown,
  ): Promise<z.output<Schema>> => parseJson(schema, await send({ method: 'POST', path, json }));

  return {
    health: async () => parseJson(healthSchema, await send({ path: '/health', accept: [503] })),
    metrics: async () => (await send({ path: '/metrics' })).text(),
    openApi: async () => get(openApiSchema, '/openapi.json'),
    uploadDocument: async (input) =>
      parseJson(
        uploadResultSchema,
        await send({ method: 'POST', path: '/documents', form: uploadForm(input) }),
      ),
    listDocuments: async (query = {}) => get(documentListSchema, '/documents', query),
    getDocument: async (id, query = {}) => get(documentSchema, documentPath(id), query),
    listDocumentEvents: async (id) => get(documentEventListSchema, `${documentPath(id)}/events`),
    downloadFile: async (id) => downloadedFile(await send({ path: `${documentPath(id)}/file` })),
    correctDocument: async (id, correction) =>
      parseJson(
        documentSchema,
        await send({ method: 'PATCH', path: documentPath(id), json: correction }),
      ),
    retryDocument: async (id) =>
      parseJson(documentSchema, await send({ method: 'POST', path: `${documentPath(id)}/retry` })),
    reclassifyDocument: async (id, input = {}) =>
      post(documentSchema, `${documentPath(id)}/reclassify`, input),
    deleteDocument: async (id) => {
      await send({ method: 'DELETE', path: documentPath(id) });
    },
    search: async (request) => post(searchResultsSchema, '/search', request),
    query: async (request) => post(queryResultSchema, '/query', request),
    listTypes: async (query = {}) => get(typeListSchema, '/types', query),
    createType: async (request) => post(createdTypeSchema, '/types', request),
    listEntities: async (query = {}) => get(entityListSchema, '/entities', query),
    listSubjects: async (query = {}) => get(listSubjectsOutputSchema, '/subjects', query),
    graph: async (query = {}) => get(graphSchema, '/graph', query),
    upcoming: async (query) => get(upcomingOutputSchema, '/upcoming', query),
    listChanges: async (query = {}) => get(changeListSchema, '/changes', query),
    decideChange: async (id, decision) =>
      post(changeDecisionResultSchema, `/changes/${encodeURIComponent(id)}`, decision),
    requestConsolidationRun: async () =>
      parseJson(
        consolidationRunSchema,
        await send({ method: 'POST', path: '/consolidation/runs' }),
      ),
    getSettings: async () => get(settingsStateSchema, '/settings'),
    saveSettings: async (update) =>
      parseJson(
        settingsStateSchema,
        await send({ method: 'PUT', path: '/settings', json: update }),
      ),
    checkSettings: async (request) => post(settingsCheckSchema, '/settings/check', request),
  };
};
