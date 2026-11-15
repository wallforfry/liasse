import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authAccounts, authApiKeys, authSessions, authUsers } from '../db/schema/index.ts';
import { isId } from '../domain/ids.ts';
import {
  createTestApiKey,
  createTestDatabase,
  TEST_ACCOUNT,
  TEST_AUTH_SECRET,
  type TestDatabase,
} from '../testing/index.ts';
import { bootstrapAccount } from './bootstrap.ts';
import { API_KEY_PREFIX, createAuth } from './create-auth.ts';
import { authIdOf } from './models.ts';

const PUBLIC_URL = 'https://liasse.example.com';

describe('the auth server', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.dispose();
  });

  const auth = () =>
    createAuth({
      db: database.db,
      secret: TEST_AUTH_SECRET,
      publicUrl: PUBLIC_URL,
      sessionTtlMs: 60_000,
      report: () => undefined,
    });

  it('creates the bootstrap account on an empty table, and never again', async () => {
    const server = auth();
    expect(await bootstrapAccount(server, database.db, TEST_ACCOUNT)).toBe('created');
    const other = { email: 'other@example.com', password: 'synthetic-other-password' };
    expect(await bootstrapAccount(server, database.db, other)).toBe('kept');
    expect(await bootstrapAccount(server, database.db, TEST_ACCOUNT)).toBe('kept');
    const users = await database.db.select().from(authUsers);
    expect(users.map(({ email }) => email)).toEqual([TEST_ACCOUNT.email]);
    const accounts = await database.db.select().from(authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password).not.toContain(TEST_ACCOUNT.password);
    await expect(
      server.api.signInEmail({ body: { email: other.email, password: other.password } }),
    ).rejects.toThrow();
    const { user } = await server.api.signInEmail({ body: TEST_ACCOUNT });
    expect(isId('usr', user.id)).toBe(true);
  });

  it('lets two instances bootstrap one empty database together: one account, no error', async () => {
    const empty = await createTestDatabase();
    try {
      const instance = () =>
        createAuth({
          db: empty.db,
          secret: TEST_AUTH_SECRET,
          publicUrl: PUBLIC_URL,
          sessionTtlMs: 60_000,
          report: () => undefined,
        });
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, async () => bootstrapAccount(instance(), empty.db, TEST_ACCOUNT)),
      );
      expect(outcomes.toSorted()).toEqual(['created', 'kept', 'kept', 'kept']);
      expect(await empty.db.select({ email: authUsers.email }).from(authUsers)).toEqual([
        { email: TEST_ACCOUNT.email },
      ]);
    } finally {
      await empty.dispose();
    }
  });

  it('refuses public sign-up', async () => {
    await expect(
      auth().api.signUpEmail({
        body: { name: 'x', email: 'new@example.com', password: 'synthetic-new-password' },
      }),
    ).rejects.toThrow(/not enabled/);
  });

  it('opens sessions and issues API keys under the ids of Liasse', async () => {
    const server = auth();
    const key = await createTestApiKey(server, 'agent');
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect((await server.api.verifyApiKey({ body: { key } })).valid).toBe(true);
    expect((await server.api.verifyApiKey({ body: { key: `${key}x` } })).valid).toBe(false);
    const stored = await database.db.select().from(authApiKeys);
    expect(stored.every(({ id }) => isId('key', id))).toBe(true);
    expect(stored.map((row) => row.key)).not.toContain(key);
    const sessions = await database.db.select().from(authSessions);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every(({ id }) => isId('ses', id))).toBe(true);
  });

  it('refuses to make an id for a model it has no table for', () => {
    expect(() => authIdOf({ model: 'organization' })).toThrow(/organization/);
  });
});
