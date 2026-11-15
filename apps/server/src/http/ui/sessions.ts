import { createHash, randomBytes } from 'node:crypto';

export interface Session {
  /** What every request of this session that changes something carries back. */
  readonly csrfToken: string;
  readonly expiresAt: number;
}

export interface OpenedSession {
  /** The value of the cookie. Only its digest is kept. */
  readonly token: string;
  readonly session: Session;
}

export interface SessionStore {
  readonly open: () => OpenedSession;
  readonly find: (token: string | undefined) => Session | undefined;
  readonly close: (token: string | undefined) => void;
}

export interface SessionStoreOptions {
  readonly ttlMs: number;
  readonly now?: () => number;
}

export const newSecret = (): string => randomBytes(32).toString('base64url');

const keyOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Sessions of the web UI, held in memory: a restart logs everyone out, and logging out
 * ends the session for good. Sessions are keyed by the digest of their token, so a
 * lookup reveals nothing of a token through its timing.
 */
export const createSessionStore = ({
  ttlMs,
  now = Date.now,
}: SessionStoreOptions): SessionStore => {
  const sessions = new Map<string, Session>();
  const forgetExpired = (): void => {
    const time = now();
    sessions.forEach(({ expiresAt }, key) => {
      if (expiresAt <= time) sessions.delete(key);
    });
  };
  return {
    open: () => {
      forgetExpired();
      const token = newSecret();
      const session = Object.freeze({ csrfToken: newSecret(), expiresAt: now() + ttlMs });
      sessions.set(keyOf(token), session);
      return { token, session };
    },
    find: (token) => {
      if (token === undefined) return undefined;
      const session = sessions.get(keyOf(token));
      return session !== undefined && session.expiresAt > now() ? session : undefined;
    },
    close: (token) => {
      if (token !== undefined) sessions.delete(keyOf(token));
    },
  };
};
