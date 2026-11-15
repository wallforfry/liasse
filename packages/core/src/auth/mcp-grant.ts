import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { oauthClientRevocations, oauthClients } from '../db/schema/index.ts';

/** How long an access token of `/mcp` lives: how long a revocation must be remembered. */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 3600;

/** Whether an access token issued to `clientId` at `issuedAt` (in seconds) still holds. */
export type McpGrantCheck = (clientId: string, issuedAt: number) => Promise<boolean>;

/**
 * The client must still be registered and enabled, as the token introspection of the OAuth
 * provider requires, and the token issued after the last revocation of its client id. A
 * token issued in the second of a revocation is refused: `iat` counts whole seconds.
 */
export const createMcpGrantCheck =
  (db: Database): McpGrantCheck =>
  async (clientId, issuedAt) => {
    const [row] = await db
      .select({ disabled: oauthClients.disabled, revokedAt: oauthClientRevocations.revokedAt })
      .from(oauthClients)
      .leftJoin(oauthClientRevocations, eq(oauthClientRevocations.clientId, oauthClients.clientId))
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);
    if (row === undefined || row.disabled === true) return false;
    return row.revokedAt === null || issuedAt > Math.floor(row.revokedAt.getTime() / 1000);
  };
