import { runWithTransaction } from '@better-auth/core/context';
import { count, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { READ_COMMITTED } from '../db/isolation.ts';
import { authUsers } from '../db/schema/index.ts';
import type { Auth } from './create-auth.ts';

export interface BootstrapAccount {
  readonly email: string;
  readonly password: string;
}

/** `created`: the account was made; `kept`: accounts existed, and nothing changed. */
export type BootstrapOutcome = 'created' | 'kept';

const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.auth-bootstrap'))`;

const createAccount = async (auth: Auth, { email, password }: BootstrapAccount) => {
  const context = await auth.$context;
  await runWithTransaction(context.adapter, async () => {
    const hash = await context.password.hash(password);
    const normalized = email.toLowerCase();
    const user = await context.internalAdapter.createUser(
      { email: normalized, name: normalized, emailVerified: true },
      { method: 'email-password' },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    });
  });
};

/**
 * Creates the first account, with its password, when no account exists at all. Public
 * sign-up is closed, so the account goes through the internal adapter of better-auth, as
 * its own sign-up does. Instances starting together on an empty database take turns under
 * an advisory lock, held until the account is committed: the next one counts it.
 */
export const bootstrapAccount = async (
  auth: Auth,
  db: Database,
  account: BootstrapAccount,
): Promise<BootstrapOutcome> =>
  db.transaction(
    async (tx) => {
      await tx.execute(LOCK);
      const [users] = await tx.select({ total: count() }).from(authUsers);
      if ((users?.total ?? 0) > 0) return 'kept';
      // better-auth writes on a connection of its own, committed before the lock is released.
      await createAccount(auth, account);
      return 'created';
    },
    { isolationLevel: READ_COMMITTED },
  );
