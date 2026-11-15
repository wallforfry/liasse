// What the server and the single-page application share outside the agent API: neither the
// SDK nor the OpenAPI document describes it.

/** The `<meta property>` the server writes the CSP nonce of a page into, in its `nonce`. */
export const CSP_NONCE_META_PROPERTY = 'csp-nonce';

/** Where the auth server (better-auth) answers: sign-in, sessions, API keys, OAuth. */
export const AUTH_BASE_PATH = '/api/auth';
