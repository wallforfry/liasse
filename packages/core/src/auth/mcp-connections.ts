import type { McpConnection, McpConnectionList } from '@liasse/contract';
import { and, desc, eq, gt, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import {
  oauthAccessTokens,
  oauthClientRevocations,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from '../db/schema/index.ts';
import { MCP_ACCESS_TOKEN_TTL_SECONDS } from './mcp-grant.ts';

type TokenTable = typeof oauthRefreshTokens | typeof oauthAccessTokens;

interface TokenSummary {
  readonly clientId: string;
  readonly active: number;
  readonly lastIssuedAt: Date | null;
}

// The recorded tokens of each client: refresh tokens, and the opaque access tokens the
// provider issues without a resource. Neither holds the token itself in what is read here.
const tokenSummaries = async (
  db: Database,
  table: TokenTable,
  clientIds: readonly string[],
  now: Date,
): Promise<readonly TokenSummary[]> =>
  db
    .select({
      clientId: table.clientId,
      active: sql<number>`count(*) filter (where ${and(isNull(table.revoked), gt(table.expiresAt, now))})::int`,
      lastIssuedAt: max(table.createdAt),
    })
    .from(table)
    .where(inArray(table.clientId, [...clientIds]))
    .groupBy(table.clientId);

const latest = (dates: readonly (Date | null)[]): Date | null =>
  dates.reduce<Date | null>(
    (found, date) => (date !== null && (found === null || date > found) ? date : found),
    null,
  );

/** Every OAuth client registered with the authorization server of MCP, newest first. */
export const listMcpConnections = async (db: Database): Promise<McpConnectionList> => {
  const clients = await db
    .select({
      id: oauthClients.id,
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      uri: oauthClients.uri,
      redirectUris: oauthClients.redirectUris,
      createdAt: oauthClients.createdAt,
    })
    .from(oauthClients)
    .orderBy(desc(oauthClients.createdAt), desc(oauthClients.id));
  if (clients.length === 0) return { connections: [] };
  const clientIds = clients.map(({ clientId }) => clientId);
  const now = new Date();
  const [refresh, access, consents] = await Promise.all([
    tokenSummaries(db, oauthRefreshTokens, clientIds, now),
    tokenSummaries(db, oauthAccessTokens, clientIds, now),
    db
      .select({ clientId: oauthConsents.clientId, scopes: oauthConsents.scopes })
      .from(oauthConsents)
      .where(inArray(oauthConsents.clientId, clientIds)),
  ]);
  const summariesOf = (clientId: string) =>
    [...refresh, ...access].filter((summary) => summary.clientId === clientId);
  const connectionOf = (client: (typeof clients)[number]): McpConnection => {
    const summaries = summariesOf(client.clientId);
    const lastIssuedAt = latest(summaries.map(({ lastIssuedAt }) => lastIssuedAt));
    const scopes = consents
      .filter((consent) => consent.clientId === client.clientId)
      .flatMap((consent) => consent.scopes);
    return {
      id: client.id,
      client_id: client.clientId,
      name: client.name,
      client_uri: client.uri,
      redirect_uris: client.redirectUris,
      created_at: client.createdAt?.toISOString() ?? null,
      granted_scopes: [...new Set(scopes)].toSorted(),
      active_tokens: summaries.reduce((total, { active }) => total + active, 0),
      last_token_issued_at: lastIssuedAt?.toISOString() ?? null,
    };
  };
  return { connections: clients.map(connectionOf) };
};

/**
 * Revokes the client of the row `id`: records when, for `/mcp` to refuse the access tokens
 * issued to it before, then deletes the client, which takes its refresh tokens, recorded
 * access tokens, consents and resource links with it. False when no client has that id.
 */
export const revokeMcpConnection = async (db: Database, id: string): Promise<boolean> =>
  db.transaction(async (tx) => {
    const [client] = await tx
      .delete(oauthClients)
      .where(eq(oauthClients.id, id))
      .returning({ clientId: oauthClients.clientId });
    if (client === undefined) return false;
    const revokedAt = new Date();
    await tx
      .insert(oauthClientRevocations)
      .values({ clientId: client.clientId, revokedAt })
      .onConflictDoUpdate({ target: oauthClientRevocations.clientId, set: { revokedAt } });
    // A revocation older than the lifetime of an access token has nothing left to refuse.
    await tx
      .delete(oauthClientRevocations)
      .where(
        lt(
          oauthClientRevocations.revokedAt,
          new Date(revokedAt.getTime() - MCP_ACCESS_TOKEN_TTL_SECONDS * 1000),
        ),
      );
    return true;
  });
