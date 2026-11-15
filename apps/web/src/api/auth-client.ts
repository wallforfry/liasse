import { apiKeyClient } from '@better-auth/api-key/client';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { AUTH_BASE_PATH } from '@liasse/contract';
import { createAuthClient } from 'better-auth/client';

export interface AuthClientOptions {
  readonly baseUrl: string;
  /** The global `fetch` unless given; tests answer in its place. */
  readonly fetch?: typeof fetch;
}

/**
 * The auth server of Liasse (better-auth), on the same origin as the page: the browser
 * sends the session cookie. The OAuth plugin adds the signed query of the page to what
 * the login and consent pages post, which continues an authorization in progress.
 */
export const createWebAuthClient = ({ baseUrl, fetch }: AuthClientOptions) =>
  createAuthClient({
    baseURL: baseUrl,
    basePath: AUTH_BASE_PATH,
    // The default redirect plugin assigns `window.location.href` from any answer with a
    // `url`: the session provider follows redirections itself, after checking the scheme.
    disableDefaultFetchPlugins: true,
    ...(fetch === undefined ? {} : { fetchOptions: { customFetchImpl: fetch } }),
    plugins: [apiKeyClient(), oauthProviderClient()],
  });

export type WebAuthClient = ReturnType<typeof createWebAuthClient>;
