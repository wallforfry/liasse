import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness, TEST_PUBLIC_URL } from '../harness.test-helper.ts';
import { type SignedIn, signIn, withHeaders } from '../ui/ui.test-helper.ts';
import {
  authorize,
  callMcp,
  type CreatedClient,
  createClient,
  LIST_TOOLS,
  MCP_HEADERS,
  MCP_RESOURCE,
} from './oauth-flow.test-helper.ts';

describe('MCP over HTTP with OAuth', () => {
  let harness: HttpHarness;
  let client: CreatedClient;

  beforeAll(async () => {
    harness = await createHttpHarness();
    const owner = await signIn(harness.app);
    client = await createClient(harness, owner, {
      grant_types: ['authorization_code'],
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const accessTokenFor = async (session: SignedIn, resource: string): Promise<string> =>
    (await authorize(harness, session, client, { resource })).access_token;

  it('serves the protected resource metadata of /mcp and the authorization server metadata', async () => {
    const resource = await harness.app.request('/.well-known/oauth-protected-resource/mcp');
    expect(resource.status).toBe(200);
    const metadata = z
      .looseObject({ resource: z.string(), authorization_servers: z.array(z.string()) })
      .parse(await resource.json());
    expect(metadata.resource).toBe(MCP_RESOURCE);
    expect(metadata.authorization_servers).toEqual([`${TEST_PUBLIC_URL}/api/auth`]);
    const server = await harness.app.request('/.well-known/oauth-authorization-server/api/auth');
    expect(server.status).toBe(200);
    const issuer = z
      .looseObject({ issuer: z.string(), authorization_endpoint: z.string() })
      .parse(await server.json());
    expect(issuer.issuer).toBe(`${TEST_PUBLIC_URL}/api/auth`);
    expect(issuer).not.toHaveProperty('registration_endpoint');
  });

  it('accepts an access token issued for /mcp, and only on /mcp', async () => {
    const session = await signIn(harness.app);
    const token = await accessTokenFor(session, MCP_RESOURCE);
    const response = await callMcp(harness, { Authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('"tools"');
    expect((await harness.app.request('/types', harness.authorized({}, token))).status).toBe(401);
  });

  it('accepts an API key', async () => {
    expect((await callMcp(harness, { Authorization: `Bearer ${harness.token}` })).status).toBe(200);
  });

  it('refuses a token of this server for another audience, and the session cookie', async () => {
    const session = await signIn(harness.app);
    const sessionToken = z
      .object({ token: z.string() })
      .parse(await (await session.request('/api/auth/token')).json()).token;
    expect(sessionToken.split('.')).toHaveLength(3);
    const otherAudience = await callMcp(harness, { Authorization: `Bearer ${sessionToken}` });
    expect(otherAudience.status).toBe(401);
    const cookie = await session.request(
      '/mcp',
      withHeaders({ method: 'POST', body: LIST_TOOLS }, MCP_HEADERS),
    );
    expect(cookie.status).toBe(401);
    expect(cookie.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${TEST_PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('refuses an access token of this server issued for another resource', async () => {
    const other = 'https://other.example.com/api';
    const owner = await signIn(harness.app);
    await harness.auth.api.adminCreateOAuthResource({
      headers: new Headers({ Cookie: owner.cookie }),
      body: { identifier: other, name: 'synthetic other resource' },
    });
    await harness.auth.api.adminLinkClientResource({
      headers: new Headers({ Cookie: owner.cookie }),
      params: { identifier: other, client_id: client.clientId },
    });
    const token = await accessTokenFor(owner, other);
    expect((await callMcp(harness, { Authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it('refuses a token whose signature was changed', async () => {
    const session = await signIn(harness.app);
    const token = await accessTokenFor(session, MCP_RESOURCE);
    const [header, payload, signature = ''] = token.split('.');
    const forged = `${header ?? ''}.${payload ?? ''}.${signature.slice(0, -4)}AAAA`;
    expect((await callMcp(harness, { Authorization: `Bearer ${forged}` })).status).toBe(401);
  });
});
