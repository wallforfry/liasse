import { apiKey } from '@better-auth/api-key';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { mcp } from '@better-auth/mcp';
import { AUTH_BASE_PATH } from '@liasse/contract';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@liasse/contract/domain';
import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import type { Database } from '../db/client.ts';
import type { Transaction } from '../db/isolation.ts';
import { authIdOf, authSchema } from './models.ts';
import { mcpConnections } from './mcp-connections-plugin.ts';
import { MCP_ACCESS_TOKEN_TTL_SECONDS } from './mcp-grant.ts';
import { mcpResourceOf } from './mcp-resource.ts';

export const API_KEY_PREFIX = 'liasse_';

/**
 * The header the HTTP server writes the socket address of the client into, after removing
 * any copy the client sent: better-auth reads the client address from headers only, and
 * this one is never trusted from outside.
 */
export const CLIENT_ADDRESS_HEADER = 'x-liasse-client-address';

export const SIGN_IN_ATTEMPTS_PER_MINUTE = 5;

/** The IPv6 prefix length one client is counted under: a host is given a whole /64. */
export const CLIENT_IPV6_SUBNET = 64;

export const UI_LOGIN_PATH = '/ui/login';
export const UI_CONSENT_PATH = '/ui/consent';

export interface AuthOptions {
  readonly db: Database;
  /** `AUTH_SECRET`. */
  readonly secret: string;
  /** `PUBLIC_URL`: the origin of every cookie, redirect, issuer and audience. */
  readonly publicUrl: string;
  readonly sessionTtlMs: number;
  /** Where better-auth reports a warning or an error, instead of the console (stdout). */
  readonly report: (level: 'warn' | 'error', message: string) => void;
}

const SECONDS = 1000;

/**
 * The database adapter of better-auth over `db`, a connection pool or a transaction.
 * `transaction: false` over a transaction, whose writes then commit or roll back with it.
 */
export const authDatabaseOf = (db: Database | Transaction, transaction: boolean) =>
  drizzleAdapter(db, { provider: 'pg', schema: { ...authSchema }, transaction });

const mcpPlugins = (publicUrl: string) => {
  const resource = mcpResourceOf(publicUrl);
  if (resource === undefined) return [];
  return [
    jwt(),
    mcp({
      resource,
      loginPage: UI_LOGIN_PATH,
      consentPage: UI_CONSENT_PATH,
      allowDynamicClientRegistration: false,
      accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
  ];
};

/**
 * The auth server: accounts with a password (no public sign-up), database sessions, API
 * keys, and, when `PUBLIC_URL` allows it, the OAuth 2.1 authorization server of MCP. Every
 * option is set here from the typed configuration, so no environment variable of
 * better-auth's own is ever read.
 */
export const createAuth = ({ db, secret, publicUrl, sessionTtlMs, report }: AuthOptions) =>
  betterAuth({
    appName: 'Liasse',
    baseURL: publicUrl,
    basePath: AUTH_BASE_PATH,
    secret,
    trustedOrigins: [publicUrl],
    telemetry: { enabled: false },
    // Only the message: the arguments that follow it may hold a request or a user.
    logger: {
      level: 'warn',
      log: (level, message) => {
        if (level === 'warn' || level === 'error') report(level, message);
      },
    },
    database: authDatabaseOf(db, true),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: Math.floor(sessionTtlMs / SECONDS),
      updateAge: Math.floor(sessionTtlMs / SECONDS / 7),
    },
    rateLimit: {
      enabled: true,
      // In the database: counts survive a restart and hold across instances.
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
        '/change-password': { window: 60, max: SIGN_IN_ATTEMPTS_PER_MINUTE },
      },
    },
    advanced: {
      // Both default to off when NODE_ENV is test: set, so a test checks what runs.
      disableCSRFCheck: false,
      disableOriginCheck: false,
      cookiePrefix: 'liasse',
      useSecureCookies: publicUrl.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', path: '/' },
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER], ipv6Subnet: CLIENT_IPV6_SUBNET },
      database: { generateId: authIdOf },
    },
    plugins: [
      apiKey({
        defaultPrefix: API_KEY_PREFIX,
        requireName: true,
        maximumNameLength: 64,
        rateLimit: { enabled: false },
        enableSessionForAPIKeys: false,
      }),
      ...mcpPlugins(publicUrl),
      mcpConnections(db),
    ],
  });

export type Auth = ReturnType<typeof createAuth>;
