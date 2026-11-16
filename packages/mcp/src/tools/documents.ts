import {
  documentCorrectionSchema,
  documentReclassificationSchema,
  getDocumentOptionsSchema,
  idSchema,
  ingestRequestSchema,
} from '@liasse/contract';
import { liveDocumentStatusSchema } from '@liasse/contract/domain';
import {
  correctDocument,
  CORRECTED_PARTS,
  getDocument,
  listDocumentEvents,
  reclassifyDocument,
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
  'is what you know of it, `private` keeps it out of searches unless asked for. ' +
  'Processing is asynchronous: the answer is the id and status, then call `get_status`. ' +
  'The same bytes give back the document they already have (`duplicate`). `url` is not ' +
  'accepted by this server yet.';

// A tool polled until processing ends: the whole log is `GET /documents/:id/events`.
const STATUS_EVENTS = 10;

const GET_STATUS_DESCRIPTION =
  `Processing status of a document (${liveDocumentStatusSchema.options.join(', ')}), ` +
  `with its error if any, and \`events\`, the last ${String(STATUS_EVENTS)} of its processing ` +
  'log, oldest first: each stage that ' +
  'succeeded and each attempt that failed, with its error code, whether it is retried, ' +
  'the model and counts such as the values the model returned that were rejected.';

const UPDATE_DESCRIPTION =
  'Corrects a document: its type, core values, fields, or its `private` flag. In `core` and ' +
  '`fields`, a value sets a field and `null` clears it. `confirm` maps core values or ' +
  'fields that are right as they are to the value `get_document` gave for each: each keeps ' +
  'its value, never rewritten, and becomes manual; a value that changed since is refused ' +
  '(`value_changed`): read the document again. Naming the type, even the current one, ' +
  'vouches for it. ' +
  'Correcting or confirming anything of the type, core or fields clears `needs_review`. A ' +
  'manual correction takes precedence: consolidation never overwrites it. Returns the ' +
  `corrected document with its fields and provenance. ${UNTRUSTED}`;

const RETRY_DESCRIPTION =
  'Processes a `failed` document again from its stored file, for instance after a provider ' +
  'outage. Refused for any other status. Returns its id and new status; then call `get_status`.';

const RECLASSIFY_DESCRIPTION =
  'Decides the type of an `indexed` or `needs_review` document again, because the one it ' +
  'has is wrong: that type is not offered. `hint` says what the right type is, `new_type` ' +
  'asks for a new type only. Its fields are then extracted again for the type chosen. ' +
  'Refused while the document is processed. Returns its id and status; then call ' +
  '`get_status`. To set a type you know, use `update_document`.';

export const registerDocumentTools = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerTool(
    'get_document',
    {
      description: GET_DOCUMENT_DESCRIPTION,
      inputSchema: getDocumentInputSchema,
      annotations: READ_ONLY,
    },
    async ({ id, ...options }) =>
      toolAnswer('get_document', report, () => getDocument(api, id, options)),
  );
  server.registerTool(
    'get_status',
    { description: GET_STATUS_DESCRIPTION, inputSchema: statusInputSchema, annotations: READ_ONLY },
    async ({ id }) =>
      toolAnswer('get_status', report, async () => {
        const { status, state, error } = await getDocument(api, id);
        const { events } = await listDocumentEvents(api, id, { last: STATUS_EVENTS });
        return { id, status, state, error, events };
      }),
  );
  server.registerTool(
    'ingest',
    {
      description: INGEST_DESCRIPTION,
      inputSchema: ingestRequestSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toolAnswer('ingest', report, async () => uploadDocument(api, toUpload(input))),
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
        await retryDocument(api, id);
        const { status, state, error } = await getDocument(api, id);
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
        await reclassifyDocument(api, id, reclassification);
        const { status, state, error } = await getDocument(api, id);
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
        await correctDocument(api, id, correction);
        return getDocument(api, id, { include: [...CORRECTED_PARTS] });
      }),
  );
};
