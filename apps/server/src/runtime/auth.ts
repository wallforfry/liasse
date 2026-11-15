import { type Auth, bootstrapAccount, createAuth } from '@liasse/core/auth';
import type { Config } from '@liasse/core/config';
import type { Database } from '@liasse/core/db';
import type { Logger } from '../log.ts';

export interface StartAuthOptions {
  readonly db: Database;
  readonly config: Config;
  readonly logger: Logger;
}

const BOOTSTRAP_NOTICES = {
  created: 'Created the first account from AUTH_BOOTSTRAP_EMAIL and AUTH_BOOTSTRAP_PASSWORD.',
  kept:
    'Notice: AUTH_BOOTSTRAP_EMAIL and AUTH_BOOTSTRAP_PASSWORD are ignored, since an account ' +
    'exists already. Unset them; change the password from the web UI.',
} as const;

/** The auth server of the HTTP front, and the first account when the configuration asks. */
export const startAuth = async ({ db, config, logger }: StartAuthOptions): Promise<Auth> => {
  const auth = createAuth({
    db,
    secret: config.auth.secret,
    publicUrl: config.server.publicUrl,
    sessionTtlMs: config.auth.sessionTtlMs,
    report: (level, message) => {
      logger.event('auth_server', { level, message });
    },
  });
  const { bootstrap } = config.auth;
  if (bootstrap !== undefined) {
    logger.notice(BOOTSTRAP_NOTICES[await bootstrapAccount(auth, bootstrap)]);
  }
  return auth;
};
