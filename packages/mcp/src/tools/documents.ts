import {
  documentCorrectionSchema,
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

const GET_DOCUMENT_DESCRIPTION =
  'Details of one document by its id, private documents included. `include` adds parts: ' +
  '`fields` (the fields of its type, with the ones corrected by hand), `text` (its full ' +
  'text, a slice at a time: `text_offset`, `text_limit`, then `has_more`), `pages` (the ' +
  'text page by page), `file_url` (a signed URL of the original file, valid 15 minutes), ' +
  `\`provenance\` (where each value was read). ${UNTRUSTED}`;

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
  'Corrects a document: its type, core values, fields, or its `private` flag. A manual ' +
  'correction takes precedence: consolidation never overwrites it. Returns the corrected ' +
  `document with its fields and provenance. ${UNTRUSTED}`;

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
