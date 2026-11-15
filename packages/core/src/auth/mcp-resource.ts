export const MCP_PATH = '/mcp';

const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

/**
 * The protected resource MCP access tokens are issued for, `PUBLIC_URL/mcp`, or undefined
 * when `PUBLIC_URL` is plain http on another host than the loopback: OAuth 2.1 and the
 * MCP authorization profile require https there, so MCP over HTTP then takes API keys only.
 */
export const mcpResourceOf = (publicUrl: string): string | undefined => {
  const { protocol, hostname } = new URL(publicUrl);
  const allowed = protocol === 'https:' || LOOPBACK_HOSTS.includes(hostname);
  return allowed ? `${new URL(publicUrl).origin}${MCP_PATH}` : undefined;
};
