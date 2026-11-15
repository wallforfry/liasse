import {
  createDpopReplayStore,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
  verifyJwsAccessToken,
} from 'better-auth/oauth2';
import { errors } from 'jose';
import type { Auth } from './create-auth.ts';

/** What of an HTTP request proves an OAuth access token. */
export interface AccessTokenRequest {
  /** The `Authorization` header. */
  readonly authorization: string | undefined;
  /** The `DPoP` header, for a sender-constrained token. */
  readonly dpop: string | undefined;
  readonly method: string;
  /** The URL the client called, on `PUBLIC_URL`: what a DPoP proof is bound to. */
  readonly url: string;
}

export type AccessTokenCheck = (request: AccessTokenRequest) => Promise<boolean>;

// What says the token is not valid. Anything else, such as the database not answering
// while the signing keys are read, is a failure of the server.
const isRefusal = (error: unknown): boolean =>
  (error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout)) ||
  isDpopBindingError(error);

// The `typ` the OAuth provider of better-auth writes in the header of an access token.
const ACCESS_TOKEN_TYPE = 'at+jwt';

/**
 * Checks an OAuth access token issued by this server for `resource`: its signature, by the
 * keys of this server read in process, its issuer, audience, type and expiry, then its
 * DPoP binding. `requireMcpAuth` of `@better-auth/mcp` does the same but fetches the key
 * set over HTTP from `PUBLIC_URL`, which a server behind a proxy may not reach.
 */
export const createAccessTokenCheck = (auth: Auth, resource: string): AccessTokenCheck => {
  const jwksCacheKey = {};
  const context = auth.$context;
  return async ({ authorization: header, dpop, method, url }) => {
    const authorization = parseAccessTokenAuthorization(header);
    if (authorization?.token === undefined || authorization.scheme === 'Unknown') return false;
    const { baseURL, internalAdapter } = await context;
    try {
      const payload = await verifyJwsAccessToken(authorization.token, {
        jwksFetch: async () => auth.api.getJwks(),
        jwksCacheKey,
        verifyOptions: {
          issuer: baseURL,
          audience: resource,
          typ: ACCESS_TOKEN_TYPE,
          requiredClaims: ['azp'],
        },
      });
      await enforceDpopBinding({
        payload,
        authorization,
        proofJwt: dpop,
        method,
        url,
        replayStore: createDpopReplayStore(internalAdapter),
      });
      return true;
    } catch (error) {
      if (isRefusal(error)) return false;
      throw error;
    }
  };
};
