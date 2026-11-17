import {
  changeDecisionSchema,
  describeTypesOptionsSchema,
  idSchema,
  listChangesOptionsSchema,
  listEntitiesRequestSchema,
} from '@liasse/contract';
import { applyChange, describeTypes, listChanges, listEntities } from '@liasse/core/api';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type McpDeps, UNTRUSTED } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const applyChangeInputSchema = z.strictObject({ id: idSchema, ...changeDecisionSchema.shape });

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
  `approval, each with its rationale. ${UNTRUSTED}`;

const APPLY_CHANGE_DESCRIPTION =
  'Applies or rejects a proposed change of the type registry. Returns the outcome and the ' +
  'number of documents to extract again.';

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
};
