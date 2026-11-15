import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { instant } from '../columns.ts';
import { authSessions, authUsers } from './auth.ts';

// The tables of the OAuth 2.1 authorization server of MCP (`@better-auth/mcp`, built on
// `@better-auth/oauth-provider`), with the fields that plugin expects.

const textList = (name: string) => text(name).array().$type<string[]>();

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: textList('scopes'),
    clientCredentialsScopes: textList('client_credentials_scopes').default([]),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    createdAt: instant('created_at'),
    updatedAt: instant('updated_at'),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: textList('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: textList('redirect_uris').notNull(),
    postLogoutRedirectUris: textList('post_logout_redirect_uris'),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: textList('grant_types'),
    responseTypes: textList('response_types'),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (table) => [index('oauth_clients_user_id_idx').on(table.userId)],
);

export const oauthResources = pgTable('oauth_resources', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: textList('allowed_scopes'),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: instant('created_at'),
  updatedAt: instant('updated_at'),
  policyVersion: integer('policy_version').default(1),
  metadata: jsonb('metadata'),
});

export const oauthClientResources = pgTable(
  'oauth_client_resources',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: instant('created_at'),
  },
  (table) => [
    uniqueIndex('oauth_client_resources_client_id_resource_id_idx').on(
      table.clientId,
      table.resourceId,
    ),
    index('oauth_client_resources_resource_id_idx').on(table.resourceId),
  ],
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => authSessions.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: textList('resources'),
    requestedUserInfoClaims: textList('requested_user_info_claims'),
    expiresAt: instant('expires_at'),
    createdAt: instant('created_at'),
    revoked: instant('revoked'),
    rotatedAt: instant('rotated_at'),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: instant('rotation_replay_expires_at'),
    authTime: instant('auth_time'),
    confirmation: jsonb('confirmation'),
    scopes: textList('scopes').notNull(),
  },
  (table) => [
    index('oauth_refresh_tokens_client_id_idx').on(table.clientId),
    index('oauth_refresh_tokens_session_id_idx').on(table.sessionId),
    index('oauth_refresh_tokens_user_id_idx').on(table.userId),
    index('oauth_refresh_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
  ],
);

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: text('id').primaryKey(),
    token: text('token').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => authSessions.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: textList('resources'),
    requestedUserInfoClaims: textList('requested_user_info_claims'),
    refreshId: text('refresh_id').references(() => oauthRefreshTokens.id, {
      onDelete: 'cascade',
    }),
    expiresAt: instant('expires_at'),
    createdAt: instant('created_at'),
    revoked: instant('revoked'),
    confirmation: jsonb('confirmation'),
    scopes: textList('scopes').notNull(),
  },
  (table) => [
    index('oauth_access_tokens_client_id_idx').on(table.clientId),
    index('oauth_access_tokens_session_id_idx').on(table.sessionId),
    index('oauth_access_tokens_user_id_idx').on(table.userId),
    index('oauth_access_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_tokens_refresh_id_idx').on(table.refreshId),
  ],
);

export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    resources: textList('resources'),
    requestedUserInfoClaims: textList('requested_user_info_claims'),
    scopes: textList('scopes').notNull(),
    createdAt: instant('created_at'),
    updatedAt: instant('updated_at'),
  },
  (table) => [
    index('oauth_consents_client_id_idx').on(table.clientId),
    index('oauth_consents_user_id_idx').on(table.userId),
  ],
);

// One row per client assertion (`private_key_jwt`) seen, by its `jti`, against replay.
export const oauthClientAssertions = pgTable('oauth_client_assertions', {
  id: text('id').primaryKey(),
  expiresAt: instant('expires_at').notNull(),
});

// Not a table of the plugin: when Liasse revoked each client id, so that `/mcp` refuses the
// access tokens issued to it before, which are JWTs the plugin never records. Keyed by the
// client id, not by the row of `oauth_clients`: the revocation deletes that row, and a client
// registered by metadata document comes back under the same id.
export const oauthClientRevocations = pgTable('oauth_client_revocations', {
  clientId: text('client_id').primaryKey(),
  revokedAt: instant('revoked_at').notNull(),
});
