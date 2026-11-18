import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type GoogleClient,
  GoogleAuthorizationError,
  type GoogleEndpoints,
  type GoogleOAuth,
} from './oauth.ts';

const REQUEST_TIMEOUT_MS = 30_000;
// An access token is not reused in its last minute: a download started then would fail.
const EXPIRY_MARGIN_MS = 60_000;
// The token endpoint answers these with 400 or 401 (RFC 6749, 5.2).
const REFUSALS: readonly string[] = ['invalid_grant', 'invalid_client', 'unauthorized_client'];

const tokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

const grantSchema = z.object({
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
});

const accessSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const withTimeout = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);

const postForm = async (
  url: string,
  form: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form),
    signal: withTimeout(signal),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.ok) return body;
  const refusal = tokenErrorSchema.safeParse(body);
  if (refusal.success && REFUSALS.includes(refusal.data.error)) {
    throw new GoogleAuthorizationError(`Google refused the authorization (${refusal.data.error}).`);
  }
  throw new Error(`The token endpoint of Google answered ${String(response.status)}.`);
};

interface CachedToken {
  readonly token: string;
  readonly expiresAt: number;
}

// Keyed by a digest: the refresh tokens themselves are not kept in memory beyond a call.
const cacheKey = (client: GoogleClient, refreshToken: string): string =>
  createHash('sha256').update(client.clientId).update('\0').update(refreshToken).digest('hex');

/** The OAuth client of Google on `fetch`. */
export const createGoogleOAuth = (endpoints: GoogleEndpoints): GoogleOAuth => {
  const tokens = new Map<string, CachedToken>();
  return {
    consentUrl: ({ clientId, redirectUri, scope, state, codeChallenge }) => {
      const url = new URL(endpoints.consent);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        // A refresh token, given at each consent: polling goes on without the person.
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      return url.toString();
    },
    exchange: async (client, { code, codeVerifier, redirectUri }, signal) => {
      const grant = grantSchema.parse(
        await postForm(
          endpoints.token,
          {
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
            client_id: client.clientId,
            client_secret: client.clientSecret,
          },
          signal,
        ),
      );
      if (grant.refresh_token === undefined) {
        throw new GoogleAuthorizationError('Google gave no refresh token for offline access.');
      }
      return { refreshToken: grant.refresh_token, scopes: grant.scope.split(' ') };
    },
    accessToken: async (client, refreshToken, signal) => {
      const key = cacheKey(client, refreshToken);
      const cached = tokens.get(key);
      if (cached !== undefined && cached.expiresAt > Date.now()) return cached.token;
      const access = accessSchema.parse(
        await postForm(
          endpoints.token,
          {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: client.clientId,
            client_secret: client.clientSecret,
          },
          signal,
        ),
      );
      tokens.set(key, {
        token: access.access_token,
        expiresAt: Date.now() + access.expires_in * 1000 - EXPIRY_MARGIN_MS,
      });
      return access.access_token;
    },
    revoke: async (token, signal) => {
      const response = await fetch(endpoints.revoke, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: withTimeout(signal),
      });
      await response.body?.cancel();
      // 400 `invalid_token`: already revoked, or expired.
      if (!response.ok && response.status !== 400) {
        throw new Error(`The revocation endpoint of Google answered ${String(response.status)}.`);
      }
    },
  };
};
