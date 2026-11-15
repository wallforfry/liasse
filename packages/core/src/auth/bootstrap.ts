import { runWithTransaction } from '@better-auth/core/context';
import type { Auth } from './create-auth.ts';

export interface BootstrapAccount {
  readonly email: string;
  readonly password: string;
}

/** `created`: the account was made; `kept`: accounts existed, and nothing changed. */
export type BootstrapOutcome = 'created' | 'kept';

/**
 * Creates the first account, with its password, when no account exists at all. Public
 * sign-up is closed, so this goes through the internal adapter of better-auth, as its own
 * sign-up does, in one transaction.
 */
export const bootstrapAccount = async (
  auth: Auth,
  { email, password }: BootstrapAccount,
): Promise<BootstrapOutcome> => {
  const context = await auth.$context;
  return runWithTransaction(context.adapter, async () => {
    if ((await context.internalAdapter.countTotalUsers()) > 0) return 'kept';
    const hash = await context.password.hash(password);
    const normalized = email.toLowerCase();
    const user = await context.internalAdapter.createUser(
      {
        email: normalized,
        name: normalized,
        emailVerified: true,
      },
      { method: 'email-password' },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hash,
    });
    return 'created';
  });
};
