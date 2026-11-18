import { createHash, randomUUID } from 'node:crypto';
import type { GoogleClient } from '../sources/google/oauth.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** What an endpoint of the fake answers, as JSON. */
export interface FakeReply {
  readonly status: number;
  readonly body: unknown;
}

export interface ConsentChoice {
  /** The person declines: Google answers `access_denied`. */
  readonly deny?: boolean;
  /** What the person leaves ticked; the read access to Drive by default. */
  readonly scopes?: readonly string[];
}

interface PendingCode {
  readonly challenge: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

/** The authorization server of Google as Liasse uses it (RFC 6749 with PKCE, RFC 7009). */
export interface FakeOAuth {
  readonly client: GoogleClient;
  readonly token: (form: URLSearchParams) => FakeReply;
  readonly revoke: (form: URLSearchParams) => FakeReply;
  /** Whether `Authorization` carries an access token of a refresh token still valid. */
  readonly authorizes: (authorization: string | undefined) => boolean;
  readonly consent: (url: string, choice?: ConsentChoice) => Record<string, string>;
  readonly grant: () => string;
  readonly revoked: () => readonly string[];
}

const INVALID_GRANT: FakeReply = { status: 400, body: { error: 'invalid_grant' } };

export const createFakeOAuth = (): FakeOAuth => {
  const client = { clientId: `client-${randomUUID()}`, clientSecret: `secret-${randomUUID()}` };
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Map<string, readonly string[]>();
  const accessTokens = new Map<string, string>();
  const revoked: string[] = [];

  const issueRefresh = (scopes: readonly string[]): string => {
    const token = `refresh-${randomUUID()}`;
    refreshTokens.set(token, scopes);
    return token;
  };

  const exchange = (form: URLSearchParams): FakeReply => {
    const code = form.get('code') ?? '';
    const pending = codes.get(code);
    codes.delete(code);
    const challenge = createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url');
    if (pending?.challenge !== challenge || pending.redirectUri !== form.get('redirect_uri')) {
      return INVALID_GRANT;
    }
    return {
      status: 200,
      body: {
        access_token: `access-${randomUUID()}`,
        expires_in: 3599,
        refresh_token: issueRefresh(pending.scopes),
        scope: pending.scopes.join(' '),
      },
    };
  };

  const refresh = (form: URLSearchParams): FakeReply => {
    const refreshToken = form.get('refresh_token') ?? '';
    if (!refreshTokens.has(refreshToken)) return INVALID_GRANT;
    const access = `access-${randomUUID()}`;
    accessTokens.set(access, refreshToken);
    return { status: 200, body: { access_token: access, expires_in: 3599, token_type: 'Bearer' } };
  };

  return {
    client,
    token: (form) => {
      if (
        form.get('client_id') !== client.clientId ||
        form.get('client_secret') !== client.clientSecret
      ) {
        return { status: 401, body: { error: 'invalid_client' } };
      }
      return form.get('grant_type') === 'authorization_code' ? exchange(form) : refresh(form);
    },
    revoke: (form) => {
      const token = form.get('token') ?? '';
      if (!refreshTokens.delete(token)) return { status: 400, body: { error: 'invalid_token' } };
      revoked.push(token);
      return { status: 200, body: {} };
    },
    authorizes: (authorization) => {
      const access = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '';
      const refreshToken = accessTokens.get(access);
      return refreshToken !== undefined && refreshTokens.has(refreshToken);
    },
    consent: (url, { deny = false, scopes = [DRIVE_SCOPE] } = {}) => {
      const query = new URL(url).searchParams;
      const state = query.get('state') ?? '';
      if (
        query.get('client_id') !== client.clientId ||
        query.get('access_type') !== 'offline' ||
        query.get('code_challenge_method') !== 'S256'
      ) {
        throw new Error('The fake Google refuses this consent request');
      }
      if (deny) return { error: 'access_denied', state };
      const code = `code-${randomUUID()}`;
      codes.set(code, {
        challenge: query.get('code_challenge') ?? '',
        redirectUri: query.get('redirect_uri') ?? '',
        scopes,
      });
      return { code, state, scope: scopes.join(' ') };
    },
    grant: () => issueRefresh([DRIVE_SCOPE]),
    revoked: () => [...revoked],
  };
};
