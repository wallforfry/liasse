import { getCurrentDBAdapterAsyncLocalStorage } from '@better-auth/core/context';
import { count, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { READ_COMMITTED, type Transaction } from '../db/isolation.ts';
import { authUsers } from '../db/schema/index.ts';
import { type Auth, authDatabaseOf } from './create-auth.ts';

export interface FirstAccount {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

/** `created`: the account was made; `exists`: an account existed, and nothing changed. */
export type FirstAccountOutcome = 'created' | 'exists';

export interface FirstAccountOptions {
  /** Written in the transaction of the account, under its lock: both commit, or neither. */
  readonly alongside?: (tx: Transaction) => Promise<void>;
}

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.auth-bootstrap'))`;

/** Whether any account exists. */
export const hasAccount = async (db: Database | Transaction): Promise<boolean> => {
  const [users] = await db.select({ total: count() }).from(authUsers);
  return (users?.total ?? 0) > 0;
};

type AfterCommit = () => Promise<void>;

// better-auth reads the adapter of the transaction it is in from its async local storage.
// Seeding it with an adapter over `tx` makes the writes of its internal adapter part of
// `tx`, where its own transactions would each take a connection of their own.
const inTransaction = async <Result>(
  auth: Auth,
  tx: Transaction,
  pendingHooks: AfterCommit[],
  work: () => Promise<Result>,
): Promise<Result> => {
  const context = await auth.$context;
  const adapter = authDatabaseOf(tx, false)(context.options);
  const storage = await getCurrentDBAdapterAsyncLocalStorage();
  return storage.run({ adapter, pendingHooks, isTransactionActive: true }, work);
};

const createAccount = async (auth: Auth, { name, email, password }: FirstAccount) => {
  const context = await auth.$context;
  const hash = await context.password.hash(password);
  const user = await context.internalAdapter.createUser(
    { email: email.toLowerCase(), name, emailVerified: true },
    { method: 'email-password' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hash,
  });
};

/**
 * Creates the first account, with its password, when no account exists at all. Public
 * sign-up is closed, so the account goes through the internal adapter of better-auth, as
 * its own sign-up does. Callers on an empty database take turns under an advisory lock,
 * held until the account is committed: the next one counts it.
 */
export const createFirstAccount = async (
  auth: Auth,
  db: Database,
  account: FirstAccount,
  { alongside }: FirstAccountOptions = {},
): Promise<FirstAccountOutcome> => {
  const afterCommit: AfterCommit[] = [];
  const outcome = await db.transaction(
    async (tx): Promise<FirstAccountOutcome> => {
      await tx.execute(LOCK);
      if (await hasAccount(tx)) return 'exists';
      await inTransaction(auth, tx, afterCommit, () => createAccount(auth, account));
      await alongside?.(tx);
      return 'created';
    },
    { isolationLevel: READ_COMMITTED },
  );
  for (const hook of afterCommit) await hook();
  return outcome;
};
