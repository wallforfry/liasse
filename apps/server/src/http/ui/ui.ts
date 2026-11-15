import type { UiPassword } from '@liasse/core/config';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import type { Credential } from '../auth.ts';
import type { AppEnv } from '../env.ts';
import { requestTimeout } from '../guards.ts';
import { createLoginLimit, type LoginLimit } from './login-limit.ts';
import { createPasswordCheck, type PasswordCheck } from './password.ts';
import { sessionCookie } from './session-cookie.ts';
import { sessionRoutes } from './session-routes.ts';
import { createSessionStore } from './sessions.ts';
import type { WebAssets } from './web-assets.ts';
import { webRoutes } from './web-routes.ts';

export interface UiOptions {
  readonly password: UiPassword;
  readonly sessionTtlMs: number;
  /** True when `PUBLIC_URL` is https: the cookie is then `Secure`. */
  readonly secureCookies: boolean;
  /** The build of `@liasse/web`. */
  readonly assets: WebAssets;
  /** The socket address by default; a test names its own. */
  readonly clientAddress?: (context: Context) => string;
  readonly loginLimit?: LoginLimit;
  /** Built from `password` by default; a test holds the hashing open. */
  readonly checkPassword?: PasswordCheck;
  readonly now?: () => number;
}

export interface UiDependencies extends UiOptions {
  /** The request deadline of the API. */
  readonly requestTimeoutMs: number;
}

export interface Ui {
  /** Mounted under `/ui`: the session endpoints and the application. */
  readonly routes: Hono<AppEnv>;
  /** The session cookie, as one more credential of the REST API. */
  readonly credential: Credential;
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

/** The web UI: its sessions, the routes that open and close them, and its built files. */
export const createUi = ({
  password,
  sessionTtlMs,
  secureCookies,
  assets,
  requestTimeoutMs,
  clientAddress = socketAddress,
  now = Date.now,
  loginLimit = createLoginLimit({ now }),
  checkPassword = createPasswordCheck(password),
}: UiDependencies): Ui => {
  const sessions = createSessionStore({ ttlMs: sessionTtlMs, now });
  const routes = new Hono<AppEnv>()
    .route(
      '/',
      sessionRoutes({
        sessions,
        checkPassword,
        loginLimit,
        clientAddress,
        cookie: { secure: secureCookies, ttlMs: sessionTtlMs },
        timed: requestTimeout(requestTimeoutMs),
      }),
    )
    .route('/', webRoutes(assets));
  return { routes, credential: sessionCookie(sessions) };
};
