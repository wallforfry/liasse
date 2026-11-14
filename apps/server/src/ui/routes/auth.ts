import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import {
  formLimit,
  LOGIN_PATH,
  requireCsrf,
  SESSION_COOKIE,
  sessionTokenOf,
  type UiEnv,
} from '../guards.ts';
import type { LoginLimit } from '../login-limit.ts';
import { CSRF_FIELD, type Markup, notice, publicPage, UI_ROOT } from '../markup.ts';
import { type PasswordCheck, sameSecret } from '../password.ts';
import { newSecret, type SessionStore } from '../sessions.ts';
import { loginPage } from '../views/forms.ts';

// Ties the login form to the browser that loaded it, before any session exists.
export const LOGIN_COOKIE = 'liasse_login';
const LOGIN_FORM_TTL_SECONDS = 60 * 60;
// A password and a token.
const MAX_LOGIN_FORM_BYTES = 8 * 1024;
const HOME = `${UI_ROOT}/documents`;

export interface AuthRouteDeps {
  readonly sessions: SessionStore;
  readonly checkPassword: PasswordCheck;
  readonly loginLimit: LoginLimit;
  /** The address one login attempt is counted against. */
  readonly clientAddress: (context: Context) => string;
  readonly sessionTtlMs: number;
  /** True when `PUBLIC_URL` is https. */
  readonly secureCookies: boolean;
  readonly signedIn: MiddlewareHandler<UiEnv>;
}

const cookieOptions = (secure: boolean, path: string, maxAgeSeconds: number): CookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'Strict',
  path,
  maxAge: maxAgeSeconds,
});

const answerLogin = (
  context: Context<UiEnv>,
  token: string,
  status: 200 | 401 | 403 | 429,
  notices: readonly Markup[] = [],
): Response | Promise<Response> =>
  context.html(publicPage('Log in', loginPage(token, notices)), status);

export const authRoutes = ({
  sessions,
  checkPassword,
  loginLimit,
  clientAddress,
  sessionTtlMs,
  secureCookies,
  signedIn,
}: AuthRouteDeps): Hono<UiEnv> => {
  const loginCookie = cookieOptions(secureCookies, LOGIN_PATH, LOGIN_FORM_TTL_SECONDS);
  const freshLoginForm = (context: Context<UiEnv>): string => {
    const token = newSecret();
    setCookie(context, LOGIN_COOKIE, token, loginCookie);
    return token;
  };

  return new Hono<UiEnv>()
    .get('/login', (context) =>
      sessions.find(sessionTokenOf(context)) === undefined
        ? answerLogin(context, freshLoginForm(context), 200)
        : context.redirect(HOME, 303),
    )
    .post('/login', formLimit(MAX_LOGIN_FORM_BYTES), async (context) => {
      const admission = loginLimit(clientAddress(context));
      if (!admission.admitted) {
        const seconds = Math.ceil(admission.retryAfterMs / 1000);
        context.header('Retry-After', String(seconds));
        return answerLogin(context, freshLoginForm(context), 429, [
          notice(`Too many attempts. Try again in ${String(seconds)} seconds.`, 'error'),
        ]);
      }
      const body = await context.req.parseBody().catch((): Record<string, never> => ({}));
      const formToken = body[CSRF_FIELD];
      const cookieToken = getCookie(context, LOGIN_COOKIE);
      if (
        typeof formToken !== 'string' ||
        cookieToken === undefined ||
        !sameSecret(formToken, cookieToken)
      ) {
        return answerLogin(context, freshLoginForm(context), 403, [
          notice('This form expired. Enter the password again.', 'error'),
        ]);
      }
      const { password } = body;
      if (typeof password !== 'string' || !(await checkPassword(password))) {
        return answerLogin(context, cookieToken, 401, [notice('Wrong password.', 'error')]);
      }
      const { token } = sessions.open();
      deleteCookie(context, LOGIN_COOKIE, { path: LOGIN_PATH });
      setCookie(
        context,
        SESSION_COOKIE,
        token,
        cookieOptions(secureCookies, UI_ROOT, Math.floor(sessionTtlMs / 1000)),
      );
      return context.redirect(HOME, 303);
    })
    .post('/logout', signedIn, formLimit(MAX_LOGIN_FORM_BYTES), requireCsrf, (context) => {
      sessions.close(sessionTokenOf(context));
      deleteCookie(context, SESSION_COOKIE, { path: UI_ROOT });
      return context.redirect(LOGIN_PATH, 303);
    });
};
