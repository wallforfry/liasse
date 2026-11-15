import {
  type McpConnection,
  mcpConnectionListSchema,
  revokeMcpConnectionResultSchema,
} from '@liasse/contract';
import { oauthClientResources, oauthClients } from '@liasse/core/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, type HttpHarness, jsonRequest } from '../harness.test-helper.ts';
import { type SignedIn, signIn } from '../ui/ui.test-helper.ts';
import {
  authorize,
  callMcp,
  createClient,
  type IssuedTokens,
  REDIRECT_URI,
  redeemCode,
  requestCode,
} from './oauth-flow.test-helper.ts';

const LIST = '/api/auth/mcp-connections/list';
const REVOKE = '/api/auth/mcp-connections/revoke';

describe('the MCP connections of the account', () => {
  let harness: HttpHarness;
  let owner: SignedIn;

  beforeAll(async () => {
    harness = await createHttpHarness();
    owner = await signIn(harness.app);
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const list = async (): Promise<readonly McpConnection[]> => {
    const response = await owner.request(LIST);
    expect(response.status).toBe(200);
    return mcpConnectionListSchema.parse(await response.json()).connections;
  };

  const connectionOf = async (clientId: string): Promise<McpConnection | undefined> =>
    (await list()).find((connection) => connection.client_id === clientId);

  const revoke = (id: string, session = owner, origin = true) =>
    session.request(REVOKE, jsonRequest('POST', { id }), origin);

  /** A client that asks for consent and a refresh token, connected through the real flow. */
  const connect = async (extra: Readonly<Record<string, unknown>> = {}) => {
    const client = await createClient(harness, owner, {
      skip_consent: false,
      client_name: 'Synthetic MCP client',
      ...extra,
    });
    const tokens = await authorize(harness, owner, client, { scope: 'openid offline_access' });
    return { ...client, tokens };
  };

  const refresh = (clientId: string, tokens: IssuedTokens) =>
    harness.app.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token ?? '',
        client_id: clientId,
      }).toString(),
    });

  it('lists a client connected through the OAuth flow, with its consent and live tokens', async () => {
    const { clientId, tokens } = await connect();
    expect(tokens.refresh_token).toBeDefined();
    const connection = await connectionOf(clientId);
    expect(connection).toMatchObject({
      client_id: clientId,
      name: 'Synthetic MCP client',
      redirect_uris: [REDIRECT_URI],
      granted_scopes: ['offline_access', 'openid'],
      active_tokens: 1,
    });
    expect(connection?.id).toMatch(/^ocl_/);
    expect(connection?.last_token_issued_at).not.toBeNull();
  });

  it('never answers a client secret or a token', async () => {
    const { clientId, clientSecret, tokens } = await connect({
      token_endpoint_auth_method: 'client_secret_post',
    });
    expect(clientSecret).toEqual(expect.any(String));
    const [stored] = await harness.database.db
      .select({ secret: oauthClients.clientSecret })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    expect(stored?.secret).toEqual(expect.any(String));
    const body = await (await owner.request(LIST)).text();
    expect(body).toContain(clientId);
    const secrets = [
      clientSecret ?? '',
      stored?.secret ?? '',
      tokens.access_token,
      tokens.refresh_token ?? '',
    ];
    expect(secrets.filter((secret) => secret === '' || body.includes(secret))).toEqual([]);
  });

  it('revokes a client: its access token no longer opens /mcp, its refresh token is dead', async () => {
    const { clientId, tokens } = await connect();
    const bearer = { Authorization: `Bearer ${tokens.access_token}` };
    expect((await callMcp(harness, bearer)).status).toBe(200);
    const connection = await connectionOf(clientId);
    const response = await revoke(connection?.id ?? '');
    expect(response.status).toBe(200);
    expect(revokeMcpConnectionResultSchema.parse(await response.json())).toEqual({ revoked: true });
    expect(await connectionOf(clientId)).toBeUndefined();
    expect((await callMcp(harness, bearer)).status).toBe(401);
    expect((await refresh(clientId, tokens)).status).not.toBe(200);
  });

  it('refuses a token issued before the revocation once the client registers again', async () => {
    const { clientId, tokens } = await connect();
    const [row] = await harness.database.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId));
    expect((await revoke(row?.id ?? '')).status).toBe(200);
    // A client of a metadata document is registered again, under the same client id, by
    // any authorization request that names it.
    await harness.database.db
      .insert(oauthClients)
      .values({ ...row, id: `${row?.id ?? ''}_again`, clientId, redirectUris: [REDIRECT_URI] });
    expect(
      (await callMcp(harness, { Authorization: `Bearer ${tokens.access_token}` })).status,
    ).toBe(401);
  });

  it('kills the authorization codes the client got before the revocation, not others', async () => {
    const { tokens, ...client } = await connect();
    expect(tokens.access_token).not.toBe('');
    const code = await requestCode(owner, client, { scope: 'openid offline_access' });
    const { tokens: otherTokens, ...other } = await connect();
    expect(otherTokens.access_token).not.toBe('');
    const otherCode = await requestCode(owner, other, { scope: 'openid offline_access' });
    const where = eq(oauthClients.clientId, client.clientId);
    const [row] = await harness.database.db.select().from(oauthClients).where(where);
    const links = await harness.database.db
      .select()
      .from(oauthClientResources)
      .where(eq(oauthClientResources.clientId, client.clientId));
    expect((await revoke(row?.id ?? '')).status).toBe(200);
    // Registered again, as a client of a metadata document is by the token request itself.
    await harness.database.db.insert(oauthClients).values({
      ...row,
      id: `${row?.id ?? ''}_again`,
      clientId: client.clientId,
      redirectUris: [REDIRECT_URI],
    });
    await harness.database.db.insert(oauthClientResources).values([...links]);
    expect((await redeemCode(harness, client, code)).status).toBe(400);
    expect((await redeemCode(harness, other, otherCode)).status).toBe(200);
  });

  it('refuses a revocation without the Origin of the web UI, and keeps the client', async () => {
    const { clientId } = await connect();
    const connection = await connectionOf(clientId);
    const withoutOrigin = await revoke(connection?.id ?? '', owner, false);
    expect(withoutOrigin.status).toBe(403);
    const otherOrigin = await owner.request(
      REVOKE,
      {
        ...jsonRequest('POST', { id: connection?.id }),
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.net' },
      },
      false,
    );
    expect(otherOrigin.status).toBe(403);
    expect(await connectionOf(clientId)).toBeDefined();
  });

  it('answers 404 for an id that names no client', async () => {
    expect((await revoke('ocl_01JZZZZZZZZZZZZZZZZZZZZZZZ')).status).toBe(404);
  });

  it('opens neither endpoint without a session, nor with an API key', async () => {
    const { clientId } = await connect();
    const connection = await connectionOf(clientId);
    const anonymous = await harness.app.request(LIST);
    expect(anonymous.status).toBe(401);
    expect((await harness.app.request(LIST, harness.authorized())).status).toBe(401);
    const revokeWithKey = await harness.app.request(
      REVOKE,
      harness.authorized(jsonRequest('POST', { id: connection?.id })),
    );
    expect(revokeWithKey.status).toBe(401);
    expect(await connectionOf(clientId)).toBeDefined();
  });
});
