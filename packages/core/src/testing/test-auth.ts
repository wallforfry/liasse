import { type Auth, createAuth } from '../auth/create-auth.ts';
import { createFirstAccount } from '../auth/first-account.ts';
import type { Database } from '../db/client.ts';

export const TEST_AUTH_SECRET = 'synthetic-auth-secret-0123456789abcdef';
export const TEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The account of the tests, made by `createTestAuth` as the first account. */
export const TEST_ACCOUNT = {
  email: 'owner@example.com',
  password: 'synthetic-owner-password',
} as const;

export interface TestAuthOptions {
  readonly sessionTtlMs?: number;
}

/** The auth server of `PUBLIC_URL` over a test database, with the test account in it. */
export const createTestAuth = async (
  db: Database,
  publicUrl: string,
  { sessionTtlMs = TEST_SESSION_TTL_MS }: TestAuthOptions = {},
): Promise<Auth> => {
  const auth = createAuth({
    db,
    secret: TEST_AUTH_SECRET,
    publicUrl,
    sessionTtlMs,
    report: () => undefined,
  });
  await createFirstAccount(auth, db, { ...TEST_ACCOUNT, name: TEST_ACCOUNT.email });
  return auth;
};

/** A new API key of the test account, through the server API of better-auth. */
export const createTestApiKey = async (auth: Auth, name = 'test'): Promise<string> => {
  const { user } = await auth.api.signInEmail({ body: TEST_ACCOUNT });
  const { key } = await auth.api.createApiKey({ body: { name, userId: user.id } });
  return key;
};
