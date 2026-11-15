import { uiLoginSchema, type UiSession } from '@liasse/core/contract';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { validator } from 'hono/validator';
import type { AppContext, AppEnv } from '../env.ts';
import { failure, HttpFailure, invalidRequest, respondWith } from '../errors.ts';
import { jsonBody } from '../guards.ts';
import type { LoginLimit } from './login-limit.ts';
import type { PasswordCheck } from './password.ts';
import {
  clearSessionCookie,
  type CookieSettings,
  requireCsrfToken,
  sessionTokenOf,
  setSessionCookie,
} from './session-cookie.ts';
import type { Session, SessionStore } from './sessions.ts';

const BUSY_RETRY_SECONDS = 1;

export interface SessionRouteDeps {
  readonly sessions: SessionStore;
  readonly checkPassword: PasswordCheck;
  readonly loginLimit: LoginLimit;
  /** The address one login attempt is counted against. */
  readonly clientAddress: (context: Context) => string;
  readonly cookie: CookieSettings;
  /** The request deadline of the API. */
  readonly timed: MiddlewareHandler<AppEnv>;
}

const NO_SESSION = failure(401, 'no_session', 'Log in to open a session.');
const WRONG_PASSWORD = failure(401, 'wrong_password', 'Wrong password.');
const BUSY = failure(
  503,
  'login_busy',
  'Too many logins are being checked. Try again in a moment.',
);

const tooManyAttempts = (seconds: number) =>
  failure(429, 'too_many_attempts', `Too many attempts. Try again in ${String(seconds)} seconds.`);

// The validator of Hono rather than the one of the API, which would describe the route in
// the OpenAPI document.
const loginBody = validator('json', (value) => {
  const parsed = uiLoginSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpFailure(
    invalidRequest(
      parsed.error.issues.map(({ path, message }) => ({ path: path.map(String), message })),
    ),
  );
});

const answer = (context: AppContext, { csrfToken }: Session): Response =>
  context.json({ csrf_token: csrfToken } satisfies UiSession);

/**
 * `/ui/session`, the session of the web UI as JSON: `POST` logs in, `GET` reads the CSRF
 * token of the live session, `DELETE` logs out. A JSON body is all a cross-site form
 * cannot send, and the cookie is `SameSite=Strict`, so the login needs no token of its own.
 */
export const sessionRoutes = ({
  sessions,
  checkPassword,
  loginLimit,
  clientAddress,
  cookie,
  timed,
}: SessionRouteDeps): Hono<AppEnv> => {
  // Counted before the body is read, so the window also bounds the work of a refused one.
  const admitted: MiddlewareHandler<AppEnv> = async (context, next) => {
    const admission = loginLimit(clientAddress(context));
    if (admission.admitted) return next();
    const seconds = Math.ceil(admission.retryAfterMs / 1000);
    context.header('Retry-After', String(seconds));
    return respondWith(context, tooManyAttempts(seconds));
  };
  return new Hono<AppEnv>()
    .post('/session', timed, jsonBody, admitted, loginBody, async (context) => {
      const verdict = await checkPassword(context.req.valid('json').password);
      if (verdict === 'busy') {
        context.header('Retry-After', String(BUSY_RETRY_SECONDS));
        return respondWith(context, BUSY);
      }
      if (verdict === 'mismatch') return respondWith(context, WRONG_PASSWORD);
      // A browser holds one session: the one it logged in with before ends here.
      sessions.close(sessionTokenOf(context));
      const { token, session } = sessions.open();
      setSessionCookie(context, token, cookie);
      return answer(context, session);
    })
    .get('/session', timed, (context) => {
      const session = sessions.find(sessionTokenOf(context));
      return session === undefined ? respondWith(context, NO_SESSION) : answer(context, session);
    })
    .delete('/session', timed, (context) => {
      const session = sessions.find(sessionTokenOf(context));
      if (session === undefined) return respondWith(context, NO_SESSION);
      requireCsrfToken(context, session);
      sessions.close(sessionTokenOf(context));
      clearSessionCookie(context, cookie);
      return context.body(null, 204);
    });
};
