/** Where Liasse reaches Google. Tests give the address of a server of their own. */
export interface GoogleEndpoints {
  /** The consent page the browser is sent to. */
  readonly consent: string;
  readonly token: string;
  readonly revoke: string;
  /** The base of the Drive API v3. */
  readonly drive: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  consent: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  drive: 'https://www.googleapis.com/drive/v3',
};

/** Read-only access to every file of the account: the only scope that sees later files. */
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** The OAuth client of the operator's own Google Cloud project, from the settings. */
export interface GoogleClient {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface ConsentRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly state: string;
  /** The S256 challenge of the PKCE verifier kept in `state`. */
  readonly codeChallenge: string;
}

export interface CodeExchange {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
}

export interface Grant {
  readonly refreshToken: string;
  /** The scopes the person granted, who may untick some on the consent page. */
  readonly scopes: readonly string[];
}

/**
 * Google refused the client, the code or the refresh token (`invalid_grant`,
 * `invalid_client`): asking again with the same ones fails the same way.
 */
export class GoogleAuthorizationError extends Error {
  override readonly name = 'GoogleAuthorizationError';
}

/** The OAuth 2.0 client of Google the sources sign in with, with no SDK of Google. */
export interface GoogleOAuth {
  /** The consent page for a request: offline access, consent asked every time. */
  readonly consentUrl: (request: ConsentRequest) => string;
  /** Rejects with `GoogleAuthorizationError` when Google refuses the code. */
  readonly exchange: (
    client: GoogleClient,
    exchange: CodeExchange,
    signal: AbortSignal,
  ) => Promise<Grant>;
  /**
   * An access token for a refresh token, reused until shortly before it expires. Rejects
   * with `GoogleAuthorizationError` when the refresh token was revoked or expired.
   */
  readonly accessToken: (
    client: GoogleClient,
    refreshToken: string,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Revokes a token; one Google no longer knows counts as revoked. */
  readonly revoke: (token: string, signal: AbortSignal) => Promise<void>;
}
