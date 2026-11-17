import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { authAccounts, authApiKeys, authSessions, authUsers } from '../db/schema/index.ts';
import { isId } from '../domain/ids.ts';
import {
  createGate,
  createTestApiKey,
  createTestDatabase,
  TEST_ACCOUNT,
  TEST_AUTH_SECRET,
  type TestDatabase,
  waitUntil,
} from '../testing/index.ts';
import { API_KEY_PREFIX, createAuth } from './create-auth.ts';
import { createFirstAccount } from './first-account.ts';
import { authIdOf } from './models.ts';

const PUBLIC_URL = 'https://liasse.example.com';
const FIRST = { ...TEST_ACCOUNT, name: 'Synthetic Owner' } as const;
const OTHER = { name: 'Other', email: 'other@example.com', password: 'synthetic-other-password' };

const waitersSchema = z.array(z.object({ waiting: z.coerce.number() })).length(1);

// Sessions of this database waiting for an advisory lock another one holds.
const lockWaiters = async ({ db }: TestDatabase): Promise<number> => {
  const rows = await db.execute(sql`
    SELECT count(*) AS waiting FROM pg_locks l JOIN pg_database d ON d.oid = l.database
    WHERE l.locktype = 'advisory' AND NOT l.granted AND d.datname = current_database()`);
  return waitersSchema.parse([...rows])[0]?.waiting ?? 0;
};

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

  it('creates the first account on an empty table, and never again', async () => {
    const server = auth();
    expect(await createFirstAccount(server, database.db, FIRST)).toBe('created');
    expect(await createFirstAccount(server, database.db, OTHER)).toBe('exists');
    expect(await createFirstAccount(server, database.db, FIRST)).toBe('exists');
    const users = await database.db.select().from(authUsers);
    expect(users.map(({ email, name }) => ({ email, name }))).toEqual([
      { email: FIRST.email, name: FIRST.name },
    ]);
    const accounts = await database.db.select().from(authAccounts);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.password).not.toContain(TEST_ACCOUNT.password);
    await expect(
      server.api.signInEmail({ body: { email: OTHER.email, password: OTHER.password } }),
    ).rejects.toThrow();
    const { user } = await server.api.signInEmail({ body: TEST_ACCOUNT });
    expect(isId('usr', user.id)).toBe(true);
  });

  it('writes the account in the transaction of the caller: a failure after it keeps none', async () => {
    const empty = await createTestDatabase();
    try {
      const server = createAuth({
        db: empty.db,
        secret: TEST_AUTH_SECRET,
        publicUrl: PUBLIC_URL,
        sessionTtlMs: 60_000,
        report: () => undefined,
      });
      const failing = createFirstAccount(server, empty.db, FIRST, {
        alongside: () => Promise.reject(new Error('synthetic failure')),
      });
      await expect(failing).rejects.toThrow('synthetic failure');
      expect(await empty.db.select().from(authUsers)).toEqual([]);
      expect(await empty.db.select().from(authAccounts)).toEqual([]);
      expect(await createFirstAccount(server, empty.db, FIRST)).toBe('created');
    } finally {
      await empty.dispose();
    }
  });

  it('makes a second caller wait for the first account to commit, then count it', async () => {
    const empty = await createTestDatabase();
    const entered = createGate();
    const release = createGate();
    try {
      const server = createAuth({
        db: empty.db,
        secret: TEST_AUTH_SECRET,
        publicUrl: PUBLIC_URL,
        sessionTtlMs: 60_000,
        report: () => undefined,
      });
      const first = createFirstAccount(server, empty.db, FIRST, {
        alongside: async () => {
          entered.open();
          await release.opened;
        },
      });
      await entered.opened;
      const second = createFirstAccount(server, empty.db, OTHER);
      await waitUntil(async () => (await lockWaiters(empty)) > 0);
      release.open();
      expect([await first, await second]).toEqual(['created', 'exists']);
      expect(await empty.db.select({ email: authUsers.email }).from(authUsers)).toEqual([
        { email: FIRST.email },
      ]);
    } finally {
      release.open();
      await empty.dispose();
    }
  });

  it('lets two instances create the first account together: one account, no error', async () => {
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
        Array.from({ length: 4 }, async () => createFirstAccount(instance(), empty.db, FIRST)),
      );
      expect(outcomes.toSorted()).toEqual(['created', 'exists', 'exists', 'exists']);
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
