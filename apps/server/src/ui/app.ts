import type { ApiContext } from '@liasse/core/api';
import type { UiPassword } from '@liasse/core/config';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { every } from 'hono/combine';
import type { Logger } from '../log.ts';
import { createUiErrorHandler } from './error-page.ts';
import {
  formLimit,
  MAX_FORM_BYTES,
  requireCsrf,
  requireSession,
  type UiEnv,
  uiHeaders,
} from './guards.ts';
import { createLoginLimit, type LoginLimit } from './login-limit.ts';
import { createPasswordCheck } from './password.ts';
import { authRoutes } from './routes/auth.ts';
import { changePages } from './routes/changes.ts';
import { documentPages } from './routes/documents.ts';
import { searchPages } from './routes/search.ts';
import { uploadPages } from './routes/upload.ts';
import { createSessionStore } from './sessions.ts';
import { STYLESHEET } from './style.ts';

export interface UiOptions {
  readonly password: UiPassword;
  readonly sessionTtlMs: number;
  /** True when `PUBLIC_URL` is https: the cookies are then `Secure`. */
  readonly secureCookies: boolean;
  /** The socket address by default; a test names its own. */
  readonly clientAddress?: (context: Context) => string;
  readonly loginLimit?: LoginLimit;
  readonly now?: () => number;
}

export interface UiDependencies extends UiOptions {
  readonly api: ApiContext;
  readonly logger: Logger;
}

// The address of the connection, never a forwarded header a client can write. Behind a
// reverse proxy every attempt is counted against the proxy. Without a socket (a request
// handed to `fetch` directly) all attempts share one count.
const socketAddress = (context: Context): string => {
  try {
    return getConnInfo(context).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

/** The web UI, mounted under `/ui`. It calls the use cases of `@liasse/core/api` directly. */
export const createUi = ({
  api,
  logger,
  password,
  sessionTtlMs,
  secureCookies,
  clientAddress = socketAddress,
  now = Date.now,
  loginLimit = createLoginLimit({ now }),
}: UiDependencies): Hono<UiEnv> => {
  const sessions = createSessionStore({ ttlMs: sessionTtlMs, now });
  const signedIn = requireSession(sessions);
  const form = every(signedIn, formLimit(MAX_FORM_BYTES), requireCsrf);

  const ui = new Hono<UiEnv>();
  ui.use(uiHeaders);
  ui.onError(createUiErrorHandler(logger));
  ui.get('/style.css', (context) =>
    context.body(STYLESHEET, 200, { 'Content-Type': 'text/css; charset=utf-8' }),
  );
  ui.route(
    '/',
    authRoutes({
      sessions,
      checkPassword: createPasswordCheck(password),
      loginLimit,
      clientAddress,
      sessionTtlMs,
      secureCookies,
      signedIn,
    }),
  );
  ui.route('/', documentPages({ api, signedIn, form }));
  ui.route('/', searchPages({ api, signedIn }));
  ui.route('/', uploadPages({ api, signedIn }));
  ui.route('/', changePages({ api, signedIn, form }));
  return ui;
};
