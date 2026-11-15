import { z } from 'zod';

// The MCP clients connected through the OAuth server of Liasse, as the account screens of the
// web UI see them. Served by the auth server under `AUTH_BASE_PATH`: neither the SDK nor the
// OpenAPI document describes them. No answer holds a client secret or a token.

/** Where the auth server lists the MCP connections, under `AUTH_BASE_PATH`. */
export const MCP_CONNECTIONS_LIST_PATH = '/mcp-connections/list';
/** Where the auth server revokes one, under `AUTH_BASE_PATH`. */
export const MCP_CONNECTIONS_REVOKE_PATH = '/mcp-connections/revoke';

export const mcpConnectionSchema = z.strictObject({
  id: z.string().describe('The id to revoke the connection with.'),
  client_id: z
    .string()
    .describe('The OAuth client id: for a client registered by metadata document, its URL.'),
  name: z.string().nullable().describe('The name the client gave itself: untrusted.'),
  client_uri: z.string().nullable(),
  redirect_uris: z.array(z.string()),
  created_at: z.iso.datetime().nullable().describe('Unknown when the provider wrote none.'),
  granted_scopes: z
    .array(z.string())
    .describe('The scopes the account consented to, sorted; empty without a consent.'),
  active_tokens: z
    .number()
    .int()
    .min(0)
    .describe(
      'The live refresh tokens and recorded access tokens of the client. JWT access tokens ' +
        'are not recorded: they end with their short lifetime, or with a revocation.',
    ),
  last_token_issued_at: z.iso
    .datetime()
    .nullable()
    .describe('When a recorded token was last issued to the client, if one ever was.'),
});
export type McpConnection = z.output<typeof mcpConnectionSchema>;

export const mcpConnectionListSchema = z.strictObject({
  connections: z.array(mcpConnectionSchema).describe('Newest first.'),
});
export type McpConnectionList = z.output<typeof mcpConnectionListSchema>;

export const revokeMcpConnectionRequestSchema = z.strictObject({ id: z.string().min(1) });
export type RevokeMcpConnectionRequest = z.output<typeof revokeMcpConnectionRequestSchema>;

export const revokeMcpConnectionResultSchema = z.strictObject({ revoked: z.literal(true) });
export type RevokeMcpConnectionResult = z.output<typeof revokeMcpConnectionResultSchema>;
