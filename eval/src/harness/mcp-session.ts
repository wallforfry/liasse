import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Instance } from './instance.ts';

/** A tool as the answering agent is shown it. */
export interface OfferedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
}

export interface ToolResult {
  readonly isError: boolean;
  readonly text: string;
}

export interface McpSession {
  /** The read-only tools of the server: an answer never writes. */
  readonly tools: readonly OfferedTool[];
  readonly call: (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>;
  readonly close: () => Promise<void>;
}

const textOf = (content: readonly { readonly type: string; readonly text?: string }[]): string =>
  content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join('\n');

/** A client of the MCP endpoint of the instance, over Streamable HTTP with its token. */
export const openMcpSession = async (instance: Instance): Promise<McpSession> => {
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', instance.baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${instance.token}` } },
  });
  const client = new Client({ name: 'liasse-eval', version: '0.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    tools: tools
      .filter(({ annotations }) => annotations?.readOnlyHint === true)
      .map(({ name, description, inputSchema }) => ({
        name,
        description: description ?? '',
        inputSchema,
      })),
    call: async (name, args) => {
      const result = CallToolResultSchema.parse(
        await client.callTool({ name, arguments: { ...args } }),
      );
      return { isError: result.isError === true, text: textOf(result.content) };
    },
    close: () => client.close(),
  };
};
