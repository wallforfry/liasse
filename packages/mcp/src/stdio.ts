import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpDeps } from './deps.ts';
import { mcpMessageSizeLimit } from './http.ts';
import { createMcpServer } from './server.ts';

export interface StdioStreams {
  readonly input: Readable;
  readonly output: Writable;
}

export interface StdioSession {
  /** Resolves once the client is gone: its input ended, or a message could not be read. */
  readonly ended: Promise<void>;
  readonly close: () => Promise<void>;
}

/**
 * Serves MCP on the standard streams, without credentials: whoever started the process
 * holds them. Nothing else may write on the output.
 */
export const serveStdio = async (
  deps: McpDeps,
  { input, output }: StdioStreams = { input: process.stdin, output: process.stdout },
): Promise<StdioSession> => {
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport(input, output, {
    maxBufferSize: mcpMessageSizeLimit(deps.api().maxFileSize),
  });
  const ended = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  const close = (): Promise<void> => server.close();
  // The transport of the SDK does not watch for the end of its input.
  input.once('end', () => {
    void close();
  });
  await server.connect(transport);
  return { ended, close };
};
