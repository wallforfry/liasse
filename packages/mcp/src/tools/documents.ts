import {
  DEFAULT_DOCUMENT_LIST_LIMIT,
  DOCUMENT_STATUS_EVENTS,
  documentCorrectionSchema,
  documentReclassificationSchema,
  getDocumentOptionsSchema,
  idSchema,
  ingestRequestSchema,
  listDocumentsOptionsSchema,
  MAX_DOCUMENT_LIST_LIMIT,
} from '@liasse/contract';
import { liveDocumentStatusSchema } from '@liasse/contract/domain';
import {
  correctDocument,
  CORRECTED_PARTS,
  getDocument,
  getDocumentStatus,
  listDocuments,
  reclassifyDocument,
  reextractDocument,
  retryDocument,
  uploadDocument,
} from '@liasse/core/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type McpDeps, UNTRUSTED } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';
import { toUpload } from './ingest-input.ts';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const getDocumentInputSchema = z.strictObject({ id: idSchema, ...getDocumentOptionsSchema.shape });
const statusInputSchema = z.strictObject({ id: idSchema });
const correctionInputSchema = z.strictObject({ id: idSchema, ...documentCorrectionSchema.shape });
const reclassificationInputSchema = z.strictObject({
  id: idSchema,
  ...documentReclassificationSchema.shape,
});

const GET_DOCUMENT_DESCRIPTION =
  'Details of one document by its id, private documents included. `include` adds parts: ' +
  '`fields` (the fields of its type, with the ones corrected by hand), `text` (its full ' +
  'text, a slice at a time: `text_offset`, `text_limit`, then `has_more`), `pages` (the ' +
  'text page by page), `file_url` (a signed URL of the original file, valid 15 minutes), ' +
  '`provenance` (where each value was read), `review` (why it is flagged `needs_review`, ' +
  'and how sure extraction is of its type and of each value, against the threshold). ' +
  UNTRUSTED;

const INGEST_DESCRIPTION =
  'Adds a document: `file` holds its bytes, base64-encoded, with its `filename`; `hint` ' +
  'is what you know of it. `private` is false by default: set it to true for every ' +
  'sensitive piece, such as civil status, identity papers, health, tax, pay or bank ' +
  'documents. A private document is kept out of `search`, `query`, `list_documents`, ' +
  'Hindsight and external embeddings unless they ask for private documents. ' +
  'Processing is asynchronous: the answer is the id and status, `received`, then call ' +
  '`get_status`. A document stays `received` with no event in its log until its text is ' +
  'read, which can take minutes for a long scan or behind other documents: `job` in ' +
  '`get_status` says meanwhile whether it waits or runs. The same bytes give back the ' +
  'document they already have (`duplicate`). `url` is not accepted by this server yet.';

const GET_STATUS_DESCRIPTION =
  `Processing status of a document (${liveDocumentStatusSchema.options.join(', ')}), ` +
  `with its error if any, and \`events\`, the last ${String(DOCUMENT_STATUS_EVENTS)} of its ` +
  'processing log, oldest first: each stage that ' +
  'succeeded and each attempt that failed, with its error code, whether it is retried, ' +
  'the model and counts such as the values the model returned that were rejected. A stage ' +
  'is logged once it ends, so a document just ingested stays `received` with no event ' +
  'while its text is read. `job` is the processing job queued or running for it, null ' +
  'when there is none: its `kind`, its `state` (`queued` or `running`), `attempts` started ' +
  'and `max_attempts`, `queued_at`, `run_after`, and for a queued one `waiting_for`: ' +
  '`worker` when it is due, with `jobs_ahead` jobs before it, or `delay` until ' +
  '`run_after`, the backoff after a failed attempt. `analysis_pending` is true while a job ' +
  'rewrites its type or values: a settled document keeps its status during a ' +
  're-extraction or a reclassification, so wait until it is false. `updated_at` moves ' +
  'with every change of the document, a correction included.';

const LIST_DESCRIPTION =
  'Lists documents, most recently ingested first, with their id, status, type, title, ' +
  `summary and core values, \`limit\` at a time (${String(DEFAULT_DOCUMENT_LIST_LIMIT)} by ` +
  `default, at most ${String(MAX_DOCUMENT_LIST_LIMIT)}) from \`offset\`, with \`total\` and ` +
  '`has_more`. Filters: `status`, `type` (a slug or an alias), `entity` (an entity id). ' +
  'With `status: needs_review` it is the review queue: the documents a person has to ' +
  'check; read one with `get_document` and `include: ["review"]` for why, then correct or ' +
  'confirm it with `update_document`. Proposals for the type registry are ' +
  '`list_pending_changes`, not documents. Private documents are left out unless ' +
  `\`private\` is \`include\` or \`only\`. ${UNTRUSTED}`;

const UPDATE_DESCRIPTION =
  'Corrects a document: its type, core values, fields, or its `private` flag. In `core` and ' +
  '`fields`, a value sets a field and `null` clears it. `confirm` maps core values or ' +
  'fields that are right as they are to the value `get_document` gave for each: each keeps ' +
  'its value, never rewritten, and becomes manual; a value that changed since is refused ' +
  '(`value_changed`): read the document again. Naming the type, even the current one, ' +
  'vouches for it. ' +
  'Correcting or confirming anything of the type, core or fields clears `needs_review`. A ' +
  'manual correction takes precedence: consolidation never overwrites it. Returns the ' +
  `corrected document with its fields and provenance. ${UNTRUSTED} ` +
  'The documents flagged for review are listed by `list_documents` with `status: needs_review`.';

const RETRY_DESCRIPTION =
  'Processes a `failed` document again from its stored file, from the start, for instance ' +
  'after a provider outage. Refused for any other status (`document_not_failed`): for a ' +
  'settled document whose values are wrong use `reextract_document`, whose type is wrong ' +
  '`reclassify_document`. Returns its id and new status; then call `get_status`.';

const RECLASSIFY_DESCRIPTION =
  'Decides the type of an `indexed` or `needs_review` document again, because the one it ' +
  'has is wrong: that type is not offered. `hint` says what the right type is, `new_type` ' +
  'asks for a new type only. Its fields are then extracted again for the type chosen. ' +
  'Refused while the document is processed. Returns its id and status; then call ' +
  '`get_status`. To set a type you know, use `update_document`; to keep the type and ' +
  'extract its values again, `reextract_document`. `list_documents` with ' +
  '`status: needs_review` lists the documents flagged for review.';

const REEXTRACT_DESCRIPTION =
  'Extracts the values of an `indexed` or `needs_review` document again from its stored ' +
  'text, for the type it has, when that type is right but values are wrong or missing: ' +
  'the type is neither changed nor decided again, the file is not read again, and the ' +
  'values corrected or confirmed with `update_document` are kept. The document is then ' +
  'indexed and settled again, `indexed` or `needs_review` by its confidence. Refused ' +
  '(`document_not_settled`) while it is processed or a re-extraction or reclassification ' +
  'of it is pending. Returns its id and status, which does not move meanwhile: call ' +
  '`get_status` until `analysis_pending` is false. For a wrong type use ' +
  '`reclassify_document`, for a `failed` document `retry_document`.';

export const registerDocumentTools = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerTool(
    'get_document',
    {
      description: GET_DOCUMENT_DESCRIPTION,
      inputSchema: getDocumentInputSchema,
      annotations: READ_ONLY,
    },
    async ({ id, ...options }) =>
      toolAnswer('get_document', report, () => getDocument(api(), id, options)),
  );
  server.registerTool(
    'get_status',
    { description: GET_STATUS_DESCRIPTION, inputSchema: statusInputSchema, annotations: READ_ONLY },
    async ({ id }) => toolAnswer('get_status', report, () => getDocumentStatus(api(), id)),
  );
  server.registerTool(
    'list_documents',
    {
      description: LIST_DESCRIPTION,
      inputSchema: listDocumentsOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) => toolAnswer('list_documents', report, () => listDocuments(api(), options)),
  );
  server.registerTool(
    'ingest',
    {
      description: INGEST_DESCRIPTION,
      inputSchema: ingestRequestSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) =>
      toolAnswer('ingest', report, async () => uploadDocument(api(), toUpload(input))),
  );
  server.registerTool(
    'retry_document',
    {
      description: RETRY_DESCRIPTION,
      inputSchema: statusInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id }) =>
      toolAnswer('retry_document', report, async () => {
        await retryDocument(api(), id);
        const { status, state, error } = await getDocument(api(), id);
        return { id, status, state, error };
      }),
  );
  server.registerTool(
    'reclassify_document',
    {
      description: RECLASSIFY_DESCRIPTION,
      inputSchema: reclassificationInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, ...reclassification }) =>
      toolAnswer('reclassify_document', report, async () => {
        await reclassifyDocument(api(), id, reclassification);
        const { status, state, error } = await getDocument(api(), id);
        return { id, status, state, error };
      }),
  );
  server.registerTool(
    'reextract_document',
    {
      description: REEXTRACT_DESCRIPTION,
      inputSchema: statusInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id }) =>
      toolAnswer('reextract_document', report, async () => {
        await reextractDocument(api(), id);
        const { status, state, error } = await getDocument(api(), id);
        return { id, status, state, error };
      }),
  );
  server.registerTool(
    'update_document',
    {
      description: UPDATE_DESCRIPTION,
      inputSchema: correctionInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, ...correction }) =>
      toolAnswer('update_document', report, async () => {
        await correctDocument(api(), id, correction);
        return getDocument(api(), id, { include: [...CORRECTED_PARTS] });
      }),
  );
};
