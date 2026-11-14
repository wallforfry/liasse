import { queryDocuments, searchDocuments, searchRequestSchema } from '@liasse/core/api';
import { MAX_QUERY_ENTITY_NAME_LENGTH, MAX_QUERY_ENTITY_NAMES } from '@liasse/core/domain';
import { queryDslJsonSchema } from '@liasse/core/query';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type McpDeps, UNTRUSTED } from '../deps.ts';
import { toolAnswer } from '../outcome.ts';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const { $schema: _dialect, ...dslJsonSchema } = queryDslJsonSchema();

// The DSL parses the arguments itself, as it does the body of `POST /query`: its errors
// say which field, type or operator to correct, which a validation by the SDK would not.
// The schema that accepts any object is shown to the agent as the JSON Schema of the DSL.
const queryInputSchema = z.looseObject({}).meta(dslJsonSchema);

const SEARCH_DESCRIPTION =
  'Hybrid natural-language search over the documents, by words and by meaning. Prefer it ' +
  'for fuzzy questions; for numbers, amounts and dates call `describe_types`, then ' +
  '`query`. Private documents are left out unless `include_private` is true. Returns ' +
  'documents by id with title, type, core values, 1 to 3 snippets with highlight ranges, ' +
  `and a score. ${UNTRUSTED}`;

const QUERY_DESCRIPTION =
  'Structured query over the documents of one type, or over the core fields of every ' +
  'document. Call `describe_types` first to learn the types and their fields; prefer this ' +
  'tool to `search` for numeric questions, and never invent a value the result does not ' +
  'hold. An unknown type, field or operator is answered with an error that lists what ' +
  'exists, so the query can be corrected. Returns rows (id, core, the fields selected) or ' +
  'the groups of an aggregate; aggregate values and numeric group keys are a JSON number ' +
  'or an exact decimal string. Private documents are left out unless `include_private` ' +
  'is true. Even when they are left out, a name compared with an entity reveals whether ' +
  'an entity bears that name when only private documents refer to it, though no ' +
  'document, count or amount of theirs is returned. A name is compared with the ' +
  `canonical name and the first ${String(MAX_QUERY_ENTITY_NAMES - 1)} aliases of each ` +
  `entity, each cut to its first ${String(MAX_QUERY_ENTITY_NAME_LENGTH)} characters. ` +
  `Rows, snippets and the data fields of errors carry document text. ${UNTRUSTED}`;

export const registerSearchTools = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerTool(
    'search',
    {
      description: SEARCH_DESCRIPTION,
      inputSchema: searchRequestSchema,
      annotations: READ_ONLY,
    },
    async (request) => toolAnswer('search', report, () => searchDocuments(api, request)),
  );
  server.registerTool(
    'query',
    { description: QUERY_DESCRIPTION, inputSchema: queryInputSchema, annotations: READ_ONLY },
    async (input) => toolAnswer('query', report, () => queryDocuments(api, input)),
  );
};
