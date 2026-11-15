import type { ApiFeatures } from '@liasse/core/api';
import type { UiPassword } from '@liasse/core/config';
import { CSRF_HEADER, uiSessionSchema } from '@liasse/contract';
import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { AppEnv } from '../env.ts';
import { type HttpHarness, jsonRequest } from '../harness.test-helper.ts';
import type { UiOptions } from './ui.ts';
import type { WebAssets } from './web-assets.ts';

export const UI_TEST_PASSWORD = 'synthetic-ui-password';
export const TEST_CLIENT_HEADER = 'X-Test-Client';
export const TEST_SCRIPT = 'assets/index-synthetic.js';

export const TEST_INDEX =
  '<!doctype html><html lang="en"><head><title>Liasse</title>' +
  `<script type="module" crossorigin src="/ui/${TEST_SCRIPT}"></script></head>` +
  '<body><div id="root"></div></body></html>';

const encoded = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

/** A build of the web UI with one hashed script and one file of `public/`. */
export const testAssets = (): WebAssets => ({
  index: TEST_INDEX,
  files: new Map([
    [
      TEST_SCRIPT,
      { body: encoded('export {};'), type: 'text/javascript; charset=utf-8', immutable: true },
    ],
    ['favicon.svg', { body: encoded('<svg/>'), type: 'image/svg+xml', immutable: false }],
  ]),
});

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
      assets: testAssets(),
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

export const withHeaders = (
  init: RequestInit,
  headers: Readonly<Record<string, string>>,
): RequestInit => ({
  ...init,
  headers: { ...Object.fromEntries(new Headers(init.headers)), ...headers },
});

export const logIn = async (
  app: Hono<AppEnv>,
  password: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> =>
  app.request('/ui/session', withHeaders(jsonRequest('POST', { password }), headers));

export interface SignedIn {
  /** The `Cookie` header of the session. */
  readonly cookie: string;
  readonly csrf: string;
  /** A request with the cookie, and the CSRF header unless `csrf` is false. */
  readonly request: (path: string, init?: RequestInit, csrf?: boolean) => Promise<Response>;
}

export const signIn = async (app: Hono<AppEnv>): Promise<SignedIn> => {
  const response = await logIn(app, UI_TEST_PASSWORD);
  expect(response.status).toBe(200);
  const cookie = cookiesOf(response).liasse_session ?? '';
  const csrf = uiSessionSchema.parse(await response.json()).csrf_token;
  return {
    cookie,
    csrf,
    request: async (path, init = {}, sendCsrf = true) =>
      app.request(
        path,
        withHeaders(init, { Cookie: cookie, ...(sendCsrf ? { [CSRF_HEADER]: csrf } : {}) }),
      ),
  };
};
