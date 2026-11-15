import { CSRF_HEADER } from '@liasse/core/contract';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { Credential } from '../auth.ts';
import type { AppContext } from '../env.ts';
import { failure, HttpFailure } from '../errors.ts';
import { sameSecret } from './password.ts';
import type { Session, SessionStore } from './sessions.ts';

export const SESSION_COOKIE = 'liasse_session';

const SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

export interface CookieSettings {
  /** True when `PUBLIC_URL` is https. */
  readonly secure: boolean;
  readonly ttlMs: number;
}

// `Path=/`: the single-page application calls the REST API with this cookie, so it must
// reach every route, not only `/ui`.
const optionsOf = ({ secure }: CookieSettings): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'Strict',
  path: '/',
});

export const setSessionCookie = (
  context: AppContext,
  token: string,
  settings: CookieSettings,
): void => {
  setCookie(context, SESSION_COOKIE, token, {
    ...optionsOf(settings),
    maxAge: Math.floor(settings.ttlMs / 1000),
  });
};

export const clearSessionCookie = (context: AppContext, settings: CookieSettings): void => {
  deleteCookie(context, SESSION_COOKIE, optionsOf(settings));
};

export const sessionTokenOf = (context: AppContext): string | undefined =>
  getCookie(context, SESSION_COOKIE);

const CSRF_REFUSED = failure(
  403,
  'csrf_refused',
  `This request needs the ${CSRF_HEADER} header of its session. Reload the page and try again.`,
);

/** Refuses a request that changes something without the CSRF token of its session. */
export const requireCsrfToken = (context: AppContext, session: Session): void => {
  if (SAFE_METHODS.includes(context.req.method)) return;
  const presented = context.req.header(CSRF_HEADER);
  if (presented === undefined || !sameSecret(presented, session.csrfToken)) {
    throw new HttpFailure(CSRF_REFUSED);
  }
};

/**
 * The session cookie of the web UI, for a request without an `Authorization` header: a
 * request that carries one is judged on its Bearer token alone. A live session lets a GET,
 * HEAD or OPTIONS through; any other method also needs the CSRF token, else 403.
 */
export const sessionCookie =
  (sessions: SessionStore): Credential =>
  (context) => {
    if (context.req.header('Authorization') !== undefined) return false;
    const session = sessions.find(sessionTokenOf(context));
    if (session === undefined) return false;
    requireCsrfToken(context, session);
    return true;
  };
