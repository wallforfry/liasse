import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../http/env.ts';
import { failure, HttpFailure } from '../http/errors.ts';
import { CSRF_FIELD, UI_CONTENT_SECURITY_POLICY, UI_ROOT } from './markup.ts';
import { sameSecret } from './password.ts';
import type { Session, SessionStore } from './sessions.ts';

export interface UiEnv {
  readonly Variables: AppEnv['Variables'] & {
    readonly session: Session;
  };
}

export const SESSION_COOKIE = 'liasse_session';
export const LOGIN_PATH = `${UI_ROOT}/login`;

// A form of the UI holds a few fields and two JSON objects of a document at most.
export const MAX_FORM_BYTES = 256 * 1024;

/** Pages run no script; the file route keeps the `sandbox` policy it sets. */
export const uiHeaders: MiddlewareHandler<AppEnv> = async (context, next) => {
  await next();
  if (!context.res.headers.has('Content-Security-Policy')) {
    context.res.headers.set('Content-Security-Policy', UI_CONTENT_SECURITY_POLICY);
  }
};

export const sessionTokenOf = (context: Context): string | undefined =>
  getCookie(context, SESSION_COOKIE);

/** Lets a request with a live session through; any other goes to the login page. */
export const requireSession =
  (sessions: SessionStore): MiddlewareHandler<UiEnv> =>
  async (context, next) => {
    const session = sessions.find(sessionTokenOf(context));
    if (session === undefined) return context.redirect(LOGIN_PATH, 303);
    context.set('session', session);
    return next();
  };

const tooLarge = (): never => {
  throw new HTTPException(413);
};

export const formLimit = (maxSize: number): MiddlewareHandler =>
  bodyLimit({ maxSize, onError: tooLarge });

const refused = (): never => {
  throw new HttpFailure(
    failure(
      403,
      'form_refused',
      'This form expired or was not sent from this site. Reload the page and try again.',
    ),
  );
};

/** Reads the form and refuses it unless it carries the token of its session. */
export const requireCsrf: MiddlewareHandler<UiEnv> = async (context, next) => {
  const body = await context.req.parseBody().catch(() => {
    throw new HTTPException(400);
  });
  const token = body[CSRF_FIELD];
  if (typeof token !== 'string' || !sameSecret(token, context.get('session').csrfToken)) {
    refused();
  }
  await next();
};
