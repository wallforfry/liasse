import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpDeps } from './deps.ts';
import { createMcpServer } from './server.ts';

// What a JSON-RPC message adds to the file it carries: the envelope and the other arguments.
const ENVELOPE_BYTES = 1024 * 1024;

/** The largest message worth reading: a file of `maxFileSize` bytes, base64-encoded, in `ingest`. */
export const mcpMessageSizeLimit = (maxFileSize: number): number =>
  Math.ceil(maxFileSize / 3) * 4 + ENVELOPE_BYTES;

/**
 * Answers one POST of Streamable HTTP, statelessly: a server and a transport per request,
 * answered as JSON. The caller has authenticated the request, bounded its body and parsed
 * it; the transport checks the headers the protocol requires.
 */
export const handleMcpRequest = async (
  deps: McpDeps,
  request: Request,
  parsedBody: unknown,
): Promise<Response> => {
  const server = createMcpServer(deps);
  // No `sessionIdGenerator`: the transport keeps no session.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    maxRequestBodySize: mcpMessageSizeLimit(deps.api().maxFileSize),
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody });
  } finally {
    await server.close();
  }
};
