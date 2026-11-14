import type { ApiFeatures } from '@liasse/core/api';
import type { UiPassword } from '@liasse/core/config';
import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { HttpHarness } from '../http/harness.test-helper.ts';
import type { AppEnv } from '../http/env.ts';
import type { UiOptions } from './app.ts';

export const UI_TEST_PASSWORD = 'synthetic-ui-password';
export const TEST_CLIENT_HEADER = 'X-Test-Client';

export interface UiAppOptions extends Partial<UiOptions> {
  readonly features?: ApiFeatures;
  readonly requestTimeoutMs?: number;
}

/** The application with the UI on, counting login attempts by a header the test sets. */
export const uiApp = (
  harness: HttpHarness,
  { features = {}, requestTimeoutMs, ...options }: UiAppOptions = {},
): Hono<AppEnv> =>
  harness.appWith({
    features,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ui: {
      password: { kind: 'plain', value: UI_TEST_PASSWORD } satisfies UiPassword,
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
      secureCookies: true,
      clientAddress: (context) => context.req.header(TEST_CLIENT_HEADER) ?? 'client-a',
      ...options,
    },
  });

/** The `name=value` of each cookie a response sets, by name. */
export const cookiesOf = (response: Response): Readonly<Record<string, string>> =>
  Object.fromEntries(
    response.headers.getSetCookie().map((line) => {
      const [pair = ''] = line.split(';');
      const index = pair.indexOf('=');
      return [pair.slice(0, index), pair];
    }),
  );

export const setCookieLine = (response: Response, name: string): string | undefined =>
  response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));

/** The value of the hidden CSRF field of the first form of a page. */
export const csrfOf = (page: string): string => {
  const token = /name="csrf" value="([^"]+)"/.exec(page)?.[1];
  expect(token).toBeDefined();
  return token ?? '';
};

export const formRequest = (
  fields: Readonly<Record<string, string>>,
  cookie: string,
  headers: Readonly<Record<string, string>> = {},
): RequestInit => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookie,
    ...headers,
  },
  body: new URLSearchParams(fields).toString(),
});

export interface LoginForm {
  readonly cookie: string;
  readonly token: string;
}

export const openLoginForm = async (app: Hono<AppEnv>): Promise<LoginForm> => {
  const response = await app.request('/ui/login');
  expect(response.status).toBe(200);
  return {
    cookie: cookiesOf(response).liasse_login ?? '',
    token: csrfOf(await response.text()),
  };
};

export const submitLogin = async (
  app: Hono<AppEnv>,
  password: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> => {
  const form = await openLoginForm(app);
  return app.request(
    '/ui/login',
    formRequest({ csrf: form.token, password }, form.cookie, headers),
  );
};

export interface SignedIn {
  /** The `Cookie` header of the session. */
  readonly cookie: string;
  readonly csrf: string;
  readonly get: (path: string) => Promise<Response>;
  readonly post: (path: string, fields: Readonly<Record<string, string>>) => Promise<Response>;
}

export const signIn = async (app: Hono<AppEnv>): Promise<SignedIn> => {
  const response = await submitLogin(app, UI_TEST_PASSWORD);
  expect(response.status).toBe(303);
  const cookie = cookiesOf(response).liasse_session ?? '';
  const get = async (path: string) => app.request(path, { headers: { Cookie: cookie } });
  // A page that reads nothing from the database, so a short deadline never fires here.
  const csrf = csrfOf(await (await get('/ui/upload')).text());
  return {
    cookie,
    csrf,
    get,
    post: async (path, fields) => app.request(path, formRequest({ csrf, ...fields }, cookie)),
  };
};
