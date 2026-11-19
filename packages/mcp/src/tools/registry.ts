import {
  changeDecisionSchema,
  createTypeRequestSchema,
  describeTypesOptionsSchema,
  idSchema,
  listChangesOptionsSchema,
  listEntitiesRequestSchema,
  typeSuggestionRequestSchema,
} from '@liasse/contract';
import {
  applyChange,
  createType,
  describeTypes,
  listChanges,
  listConsolidationRuns,
  listEntities,
  requestConsolidationRun,
  suggestType,
} from '@liasse/core/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type McpDeps, UNTRUSTED } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const applyChangeInputSchema = z.strictObject({ id: idSchema, ...changeDecisionSchema.shape });
const noInputSchema = z.strictObject({});

const DESCRIBE_TYPES_DESCRIPTION =
  'The document types Liasse has learnt, with their description, aliases, fields and ' +
  'document count. Call it before `query`, to know which types and fields exist. The ' +
  'counts leave private documents out unless `include_private` is true; a type known only ' +
  'from private documents is still listed, with a count of 0. Descriptions and example ' +
  `titles come from documents. ${UNTRUSTED}`;

const LIST_ENTITIES_DESCRIPTION =
  'Lists the people, organisations and other entities named in the documents, or those ' +
  'whose name matches `query`, with their aliases, identifiers (an IBAN or a card number ' +
  'is masked) and document count. The counts leave private documents out unless ' +
  '`include_private` is true; an entity known only from private documents is still ' +
  `listed, with its names and a count of 0. ${UNTRUSTED}`;

const LIST_CHANGES_DESCRIPTION =
  'The changes of the type registry that consolidation proposes and that wait for ' +
  'approval, each with its rationale: merges and stabilization of types, ' +
  'promotion and removal of fields, merges of entities and of subjects. It lists no ' +
  'document: the documents flagged for a person to review are `list_documents` with ' +
  '`status: needs_review`, each corrected or confirmed with `update_document`. ' +
  UNTRUSTED;

const APPLY_CHANGE_DESCRIPTION =
  'Applies or rejects a proposed change of the type registry, by the id ' +
  '`list_pending_changes` gave. Returns the outcome and the number of documents to extract ' +
  'again. It reviews no document and clears no `needs_review` flag: that is ' +
  '`update_document`, on the documents of `list_documents` with `status: needs_review`.';

const CREATE_TYPE_DESCRIPTION =
  'Creates a document type by hand, for documents no type fits: `slug` (snake_case, ' +
  'English, generic to specific), `description`, an optional `parent_slug` (the hierarchy ' +
  'has two levels) and its `fields`. It is `provisional`, like a type the pipeline ' +
  'creates, so consolidation may promote or merge it. A refusal answers the code of the ' +
  'registry (`invalid_slug`, `invalid_fields`, `name_taken`, ...) with what to correct. ' +
  'Call `describe_types` first: an existing type or alias may already fit. Documents ' +
  'already filed keep their type: `reclassify_document` or `update_document` moves one. ' +
  'Use it too when classification could not create the type a document needs: the ' +
  'refusal, such as `invalid_proposal`, is in `get_status` and the `review` of ' +
  '`get_document`.';

const SUGGEST_TYPE_DESCRIPTION =
  'Drafts a document type with the text model from `request`, free text on the documents ' +
  'the type is for and what to read from them. Nothing is stored: review the draft, then ' +
  'send it to `create_type`. The model is shown the closest existing types, as possible ' +
  `parents and types not to duplicate. ${UNTRUSTED}`;

const REQUEST_RUN_DESCRIPTION =
  'Asks for a consolidation run now, which reviews the type registry with the text model ' +
  'and proposes merges, promotions and cleanups. Runs also come every night and after ' +
  'every batch of new documents. `queued` is false when a run due at once was already ' +
  'waiting. Its proposals then appear in `list_pending_changes`.';

const LIST_RUNS_DESCRIPTION =
  'The latest consolidation runs, the one due last first: each with its trigger, its job ' +
  'status, its attempts, when it was queued and is due, and the redacted error of its ' +
  'latest failed attempt. A run keeps no report: what it proposed is in ' +
  '`list_pending_changes`.';

export const registerRegistryTools = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerTool(
    'describe_types',
    {
      description: DESCRIBE_TYPES_DESCRIPTION,
      inputSchema: describeTypesOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) => toolAnswer('describe_types', report, () => describeTypes(api(), options)),
  );
  server.registerTool(
    'list_entities',
    {
      description: LIST_ENTITIES_DESCRIPTION,
      inputSchema: listEntitiesRequestSchema,
      annotations: READ_ONLY,
    },
    async (request) => toolAnswer('list_entities', report, () => listEntities(api(), request)),
  );
  server.registerTool(
    'list_pending_changes',
    {
      description: LIST_CHANGES_DESCRIPTION,
      inputSchema: listChangesOptionsSchema,
      annotations: READ_ONLY,
    },
    async (options) =>
      toolAnswer('list_pending_changes', report, () => listChanges(api(), options)),
  );
  server.registerTool(
    'apply_change',
    {
      description: APPLY_CHANGE_DESCRIPTION,
      inputSchema: applyChangeInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, ...decision }) =>
      toolAnswer('apply_change', report, () => applyChange(api(), id, decision)),
  );
  server.registerTool(
    'create_type',
    {
      description: CREATE_TYPE_DESCRIPTION,
      inputSchema: createTypeRequestSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (request) => toolAnswer('create_type', report, () => createType(api(), request)),
  );
  server.registerTool(
    'suggest_type',
    {
      description: SUGGEST_TYPE_DESCRIPTION,
      inputSchema: typeSuggestionRequestSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (request) => toolAnswer('suggest_type', report, () => suggestType(api(), request)),
  );
  server.registerTool(
    'request_consolidation_run',
    {
      description: REQUEST_RUN_DESCRIPTION,
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      toolAnswer('request_consolidation_run', report, () => requestConsolidationRun(api())),
  );
  server.registerTool(
    'list_consolidation_runs',
    { description: LIST_RUNS_DESCRIPTION, inputSchema: noInputSchema, annotations: READ_ONLY },
    async () => toolAnswer('list_consolidation_runs', report, () => listConsolidationRuns(api())),
  );
};
