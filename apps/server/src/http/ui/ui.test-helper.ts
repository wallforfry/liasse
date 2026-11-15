import { TEST_ACCOUNT } from '@liasse/core/testing';
import type { Hono } from 'hono';
import { expect } from 'vitest';
import type { AppEnv } from '../env.ts';
import { jsonRequest, TEST_PUBLIC_URL } from '../harness.test-helper.ts';
import type { WebAssets } from './web-assets.ts';

export const TEST_SCRIPT = 'assets/index-synthetic.js';
export const SESSION_COOKIE = 'liasse.session_token';
// `useSecureCookies` prefixes every cookie of an https PUBLIC_URL.
export const SECURE_SESSION_COOKIE = `__Secure-${SESSION_COOKIE}`;

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

/** A request of the web UI: from the origin of `PUBLIC_URL`. */
export const fromUi = (init: RequestInit = {}): RequestInit =>
  withHeaders(init, { Origin: TEST_PUBLIC_URL });

export const signInRequest = (email: string, password: string): RequestInit =>
  fromUi(jsonRequest('POST', { email, password }));

/** The bindings the Node server gives a request: here, the address of its socket. */
export interface ClientBindings {
  readonly incoming: { readonly socket: { readonly remoteAddress: string } };
}

const clients = { count: 0 };

/**
 * A client of its own, by its socket address: better-auth counts sign-in attempts per
 * address, and a request handed to `app.request` has no socket at all.
 */
export const newClient = (): ClientBindings => {
  clients.count += 1;
  return { incoming: { socket: { remoteAddress: `198.51.100.${String(clients.count % 250)}` } } };
};

export interface SignedIn {
  /** The `Cookie` header of the session. */
  readonly cookie: string;
  /** A request with the cookie, and the `Origin` of the web UI unless `origin` is false. */
  readonly request: (path: string, init?: RequestInit, origin?: boolean) => Promise<Response>;
}

/** Signs the test account in through `POST /api/auth/sign-in/email`. */
export const signIn = async (app: Hono<AppEnv>): Promise<SignedIn> => {
  const client = newClient();
  const response = await app.request(
    '/api/auth/sign-in/email',
    signInRequest(TEST_ACCOUNT.email, TEST_ACCOUNT.password),
    client,
  );
  expect(response.status).toBe(200);
  const cookie = cookiesOf(response)[SECURE_SESSION_COOKIE] ?? '';
  expect(cookie).not.toBe('');
  return {
    cookie,
    request: async (path, init = {}, origin = true) =>
      app.request(path, withHeaders(origin ? fromUi(init) : init, { Cookie: cookie }), client),
  };
};
