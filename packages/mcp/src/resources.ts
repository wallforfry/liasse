import { describeTypes, getDocument, idSchema, MAX_TEXT_LENGTH } from '@liasse/core/api';
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { type McpDeps, UNTRUSTED } from './deps.ts';
import { resourceError, type ReportFailure } from './outcome.ts';

const JSON_TYPE = 'application/json';

export const TYPES_URI = 'types://';
export const DOCUMENT_URI_TEMPLATE = 'doc://{id}';

const read = async (
  uri: URL,
  operation: string,
  report: ReportFailure,
  work: () => Promise<unknown>,
): Promise<ReadResourceResult> => {
  try {
    return {
      contents: [{ uri: uri.href, mimeType: JSON_TYPE, text: JSON.stringify(await work()) }],
    };
  } catch (error) {
    throw resourceError(operation, report, error);
  }
};

// A template variable may be a list when the template asks for one; `doc://{id}` does not,
// so a list is an id of no document, as is anything outside the alphabet of ids.
const documentIdOf = (variable: string | readonly string[] | undefined): string =>
  typeof variable === 'string' && idSchema.safeParse(variable).success ? variable : '';

export const registerResources = (server: McpServer, { api, report }: McpDeps): void => {
  server.registerResource(
    'types',
    TYPES_URI,
    {
      description:
        'The type registry, as `describe_types` returns it; the counts leave private ' +
        `documents out. ${UNTRUSTED}`,
      mimeType: JSON_TYPE,
    },
    async (uri) => read(uri, 'types://', report, () => describeTypes(api)),
  );
  // Not listed: documents are found with `search` and `query`, never enumerated.
  server.registerResource(
    'document',
    new ResourceTemplate(DOCUMENT_URI_TEMPLATE, { list: undefined }),
    {
      description:
        `A document by its id, private ones included, with the first ${String(MAX_TEXT_LENGTH)} ` +
        'characters of its text; `get_document` reads the rest. ' +
        UNTRUSTED,
      mimeType: JSON_TYPE,
    },
    async (uri, { id }) =>
      read(uri, 'doc://', report, () =>
        getDocument(api, documentIdOf(id), { include: ['text'], text_limit: MAX_TEXT_LENGTH }),
      ),
  );
};
