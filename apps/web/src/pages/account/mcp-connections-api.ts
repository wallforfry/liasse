import {
  MCP_CONNECTIONS_LIST_PATH,
  MCP_CONNECTIONS_REVOKE_PATH,
  type McpConnection,
  mcpConnectionListSchema,
  type RevokeMcpConnectionResult,
  revokeMcpConnectionResultSchema,
} from '@liasse/contract';
import type { WebAuthClient } from '../../api/auth-client.ts';
import { unwrap } from '../../api/auth-result.ts';

export const MCP_CONNECTIONS_QUERY_KEY = ['mcp-connections'] as const;

// The default parser of the auth client turns ISO timestamps into dates, which the schemas
// of the contract read as strings.
const plainJson = (text: string): unknown => JSON.parse(text);

export const listMcpConnections = async (auth: WebAuthClient): Promise<readonly McpConnection[]> =>
  unwrap(
    mcpConnectionListSchema,
    await auth.$fetch(MCP_CONNECTIONS_LIST_PATH, { method: 'GET', jsonParser: plainJson }),
  ).connections;

export const revokeMcpConnection = async (
  auth: WebAuthClient,
  id: string,
): Promise<RevokeMcpConnectionResult> =>
  unwrap(
    revokeMcpConnectionResultSchema,
    await auth.$fetch(MCP_CONNECTIONS_REVOKE_PATH, {
      method: 'POST',
      body: { id },
      jsonParser: plainJson,
    }),
  );
