import type { PgTable } from 'drizzle-orm/pg-core';
import {
  authAccounts,
  authApiKeys,
  authRateLimits,
  authSessions,
  authSigningKeys,
  authUsers,
  authVerifications,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
} from '../db/schema/index.ts';
import { ID_PREFIXES, type IdPrefix, newId } from '../domain/ids.ts';

interface AuthModel {
  readonly table: PgTable;
  readonly prefix: IdPrefix;
}

/** Each model of better-auth, by the name better-auth gives it: its table and id prefix. */
export const AUTH_MODELS = {
  user: { table: authUsers, prefix: ID_PREFIXES.user },
  session: { table: authSessions, prefix: ID_PREFIXES.session },
  account: { table: authAccounts, prefix: ID_PREFIXES.account },
  verification: { table: authVerifications, prefix: ID_PREFIXES.verification },
  rateLimit: { table: authRateLimits, prefix: ID_PREFIXES.rateLimit },
  apikey: { table: authApiKeys, prefix: ID_PREFIXES.apiKey },
  jwks: { table: authSigningKeys, prefix: ID_PREFIXES.signingKey },
  oauthClient: { table: oauthClients, prefix: ID_PREFIXES.oauthClient },
  oauthResource: { table: oauthResources, prefix: ID_PREFIXES.oauthResource },
  oauthClientResource: { table: oauthClientResources, prefix: ID_PREFIXES.oauthClientResource },
  oauthRefreshToken: { table: oauthRefreshTokens, prefix: ID_PREFIXES.oauthRefreshToken },
  oauthAccessToken: { table: oauthAccessTokens, prefix: ID_PREFIXES.oauthAccessToken },
  oauthConsent: { table: oauthConsents, prefix: ID_PREFIXES.oauthConsent },
  oauthClientAssertion: { table: oauthClientAssertions, prefix: ID_PREFIXES.oauthClientAssertion },
} as const satisfies Readonly<Record<string, AuthModel>>;

/** The `schema` of the drizzle adapter. */
export const authSchema: Readonly<Record<string, PgTable>> = Object.fromEntries(
  Object.entries(AUTH_MODELS).map(([model, { table }]) => [model, table]),
);

const PREFIXES: ReadonlyMap<string, IdPrefix> = new Map(
  Object.entries(AUTH_MODELS).map(([model, { prefix }]) => [model, prefix]),
);

/**
 * `advanced.database.generateId`. A model without a prefix is a table a new plugin brought:
 * refused, so it gets a table and a prefix here before it is used.
 */
export const authIdOf = ({ model }: { readonly model: string }): string => {
  const prefix = PREFIXES.get(model);
  if (prefix === undefined) throw new Error(`No id prefix for the auth model ${model}.`);
  return newId(prefix);
};
