// What the server and the single-page application share outside the agent API: neither the
// SDK nor the OpenAPI document describes it.

/** The `<meta property>` the server writes the CSP nonce of a page into, in its `nonce`. */
export const CSP_NONCE_META_PROPERTY = 'csp-nonce';

/**
 * The `<meta property>` the server writes `PUBLIC_URL` into, in its `content`: the address
 * Google sends the browser back to is built from it, which a page reached at another
 * address cannot read from its own location.
 */
export const PUBLIC_URL_META_PROPERTY = 'public-url';

/** Where the auth server (better-auth) answers: sign-in, sessions, API keys, OAuth. */
export const AUTH_BASE_PATH = '/api/auth';

/** Where Google sends the browser back after a consent: the redirect URI to register. */
export const GOOGLE_CALLBACK_PATH = '/sources/google/callback';

/** The page of the web UI, under its base, that completes a consent of Google. */
export const GOOGLE_CONSENT_UI_PATH = '/sources/google';
