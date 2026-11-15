import {
  MCP_CONNECTIONS_LIST_PATH,
  MCP_CONNECTIONS_REVOKE_PATH,
  revokeMcpConnectionRequestSchema,
} from '@liasse/contract';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api';
import type { Database } from '../db/client.ts';
import { listMcpConnections, revokeMcpConnection } from './mcp-connections.ts';

/**
 * The MCP connections of the account screens: the OAuth clients registered with the
 * authorization server of MCP, listed and revoked by a signed-in person. The endpoints of
 * the OAuth provider list only the clients a user created, which a client registered by
 * metadata document never is. better-auth refuses a cookie-bearing revocation from another
 * origin than `PUBLIC_URL`, and an API key opens no session.
 */
export const mcpConnections = (db: Database) =>
  ({
    id: 'liasse-mcp-connections',
    endpoints: {
      listMcpConnections: createAuthEndpoint(
        MCP_CONNECTIONS_LIST_PATH,
        { method: 'GET', use: [sessionMiddleware] },
        async (context) => context.json(await listMcpConnections(db)),
      ),
      revokeMcpConnection: createAuthEndpoint(
        MCP_CONNECTIONS_REVOKE_PATH,
        { method: 'POST', use: [sessionMiddleware], body: revokeMcpConnectionRequestSchema },
        async (context) => {
          if (!(await revokeMcpConnection(db, context.body.id))) {
            throw new APIError('NOT_FOUND', { message: 'No MCP connection has this id.' });
          }
          return context.json({ revoked: true as const });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
