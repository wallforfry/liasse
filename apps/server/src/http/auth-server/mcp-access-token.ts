import { type Auth, createAccessTokenCheck } from '@liasse/core/auth';
import type { Credential } from '../auth.ts';

/** Where the protected resource metadata of `resource` is served (RFC 9728, section 3.1). */
export const protectedResourceMetadataUrl = (resource: string): string => {
  const { origin, pathname } = new URL(resource);
  return `${origin}/.well-known/oauth-protected-resource${pathname}`;
};

/** What a refused MCP request is answered with, so a client finds the authorization server. */
export const mcpChallenge = (resource: string): string =>
  `Bearer resource_metadata="${protectedResourceMetadataUrl(resource)}"`;

/**
 * An OAuth access token issued by this server for `resource`, as `Bearer` or `DPoP`. The
 * request URL a DPoP proof is checked against is rebuilt on `PUBLIC_URL`: behind a proxy
 * the URL the server sees is not the one the client called.
 */
export const mcpAccessToken = (auth: Auth, resource: string, publicOrigin: string): Credential => {
  const check = createAccessTokenCheck(auth, resource);
  return async (context) => {
    const { pathname, search } = new URL(context.req.url);
    return check({
      authorization: context.req.header('Authorization'),
      dpop: context.req.header('DPoP'),
      method: context.req.method,
      url: `${publicOrigin}${pathname}${search}`,
    });
  };
};
