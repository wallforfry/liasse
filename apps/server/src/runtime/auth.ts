import { type Auth, createAuth, hasAccount } from '@liasse/core/auth';
import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import { issueSetupToken, type SetupToken } from '@liasse/core/setup';
import type { Logger } from '../log.ts';

export interface StartAuthOptions {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
}

export interface StartedAuth {
  readonly auth: Auth;
  /** Issued while no account exists; undefined otherwise. */
  readonly setupToken: SetupToken | undefined;
}

// The one line that holds the token: the operator copies it from stderr into the
// onboarding. Only its hash stays in memory.
const setupNotice = (publicUrl: string, token: string): string =>
  `Notice: no account exists yet. Open ${publicUrl}/ui/ to create the first one, with this ` +
  `setup token: ${token} (valid until the server stops; a restart prints another one).`;

/** The auth server of the HTTP front, and the setup token while no account exists. */
export const startAuth = async ({ db, config, logger }: StartAuthOptions): Promise<StartedAuth> => {
  const auth = createAuth({
    db,
    secret: config.auth.secret,
    publicUrl: config.server.publicUrl,
    sessionTtlMs: config.auth.sessionTtlMs,
    report: (level, message) => {
      logger.event('auth_server', { level, message });
    },
  });
  if (await hasAccount(db)) return { auth, setupToken: undefined };
  const { value, token } = issueSetupToken();
  logger.notice(setupNotice(config.server.publicUrl, value));
  return { auth, setupToken: token };
};
