import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { z } from 'zod';
import { UI_CONSENT_PATH } from '@liasse/core/auth';
import { type HttpHarness, jsonRequest, TEST_PUBLIC_URL } from '../harness.test-helper.ts';
import type { SignedIn } from '../ui/ui.test-helper.ts';

export const MCP_RESOURCE = `${TEST_PUBLIC_URL}/mcp`;
export const REDIRECT_URI = 'https://client.example.net/callback';

export const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
export const LIST_TOOLS = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

const tokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string().optional(),
});
export type IssuedTokens = z.output<typeof tokenSchema>;

const base64url = (bytes: Buffer): string => bytes.toString('base64url');

/** `tools/list` on `/mcp`, with the given headers. */
export const callMcp = (harness: HttpHarness, headers: Readonly<Record<string, string>>) =>
  harness.app.request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: LIST_TOOLS,
  });

export interface CreatedClient {
  readonly clientId: string;
  /** Only for a confidential client: the provider answers it once. */
  readonly clientSecret: string | undefined;
}

/** A client created by the owner through the OAuth provider: public, without consent. */
export const createClient = async (
  harness: HttpHarness,
  owner: SignedIn,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<CreatedClient> => {
  const client = await harness.auth.api.adminCreateOAuthClient({
    headers: new Headers({ Cookie: owner.cookie }),
    body: {
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      skip_consent: true,
      ...extra,
    },
  });
  return { clientId: client.client_id, clientSecret: client.client_secret };
};

const redirectSchema = z.object({ redirect: z.literal(true), url: z.string() });

/** What the consent page posts when the person accepts, with the signed query it was given. */
const consent = async (session: SignedIn, page: URL): Promise<URL> => {
  const response = await session.request(
    '/api/auth/oauth2/consent',
    jsonRequest('POST', { accept: true, oauth_query: page.search.slice(1) }),
  );
  expect(response.status).toBe(200);
  return new URL(redirectSchema.parse(await response.json()).url);
};

export interface AuthorizationCode {
  readonly code: string;
  readonly verifier: string;
  readonly resource: string;
}

/** The authorization request of the flow, through the consent page when the client asks. */
export const requestCode = async (
  session: SignedIn,
  { clientId }: CreatedClient,
  { resource = MCP_RESOURCE, scope = 'openid' }: { resource?: string; scope?: string } = {},
): Promise<AuthorizationCode> => {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope,
    state: 'synthetic-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  });
  const redirected = await session.request(`/api/auth/oauth2/authorize?${query.toString()}`);
  expect(redirected.status).toBe(302);
  const location = new URL(redirected.headers.get('Location') ?? '', TEST_PUBLIC_URL);
  const callback =
    location.pathname === UI_CONSENT_PATH ? await consent(session, location) : location;
  const code = callback.searchParams.get('code') ?? '';
  expect(code).not.toBe('');
  return { code, verifier, resource };
};

/** The token request that redeems `code`. */
export const redeemCode = (
  harness: HttpHarness,
  { clientId, clientSecret }: CreatedClient,
  { code, verifier, resource }: AuthorizationCode,
) =>
  harness.app.request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      ...(clientSecret === undefined ? {} : { client_secret: clientSecret }),
      code_verifier: verifier,
      resource,
    }).toString(),
  });

/** The authorization code flow with PKCE, as an MCP client runs it. */
export const authorize = async (
  harness: HttpHarness,
  session: SignedIn,
  client: CreatedClient,
  options: { resource?: string; scope?: string } = {},
): Promise<IssuedTokens> => {
  const response = await redeemCode(harness, client, await requestCode(session, client, options));
  expect(response.status).toBe(200);
  return tokenSchema.parse(await response.json());
};
