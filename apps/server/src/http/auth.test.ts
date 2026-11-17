import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApiKey, TEST_ACCOUNT } from '@liasse/core/testing';
import { requireAny } from './auth.ts';
import type { AppEnv } from './env.ts';
import { createHttpHarness, type HttpHarness } from './harness.test-helper.ts';

// The web UI, the auth server and its discovery documents, which answer for themselves, and
// the onboarding, guarded by its setup token.
const PUBLIC_ROUTES = [
  'GET /health',
  'GET /api/setup',
  'POST /api/setup',
  'POST /api/setup/check',
  'GET /',
  'GET /ui/*',
  'GET /api/auth/*',
  'POST /api/auth/*',
  'GET /.well-known/*',
  'HEAD /.well-known/*',
];

// A request for each registered route, with ids no document has.
const exampleOf = (path: string): string => path.replaceAll(/:[A-Za-z]+/g, 'doc_none');

describe('authentication', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const routes = () =>
    harness.app.routes
      .filter(({ method }) => method !== 'ALL')
      .map(({ method, path }) => ({ method, path }))
      .filter(
        (route, index, all) =>
          all.findIndex((other) => other.method === route.method && other.path === route.path) ===
          index,
      );

  it('refuses every route but the public ones without a credential', async () => {
    const guarded = routes().filter(
      ({ method, path }) => !PUBLIC_ROUTES.includes(`${method} ${path}`),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(16);
    for (const { method, path } of guarded) {
      const response = await harness.app.request(exampleOf(path), { method });
      expect([method, path, response.status]).toEqual([method, path, 401]);
      expect(response.headers.get('WWW-Authenticate')).toBe(
        path === '/mcp'
          ? 'Bearer resource_metadata="https://liasse.example.com/.well-known/oauth-protected-resource/mcp"'
          : 'Bearer realm="liasse"',
      );
      expect(await response.json()).toEqual({
        error: {
          code: 'unauthorized',
          message: 'A valid Bearer token is required.',
          request_id: response.headers.get('X-Request-Id'),
        },
      });
    }
  });

  it('answers /health without a credential, with the liveness alone', async () => {
    const response = await harness.app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 on /health when the database does not answer', async () => {
    const app = harness.appWith({ ping: () => Promise.reject(new Error('synthetic outage')) });
    const response = await app.request('/health');
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"unavailable"}');
  });

  it('accepts each API key of an account', async () => {
    for (const token of [harness.token, harness.otherToken]) {
      expect((await harness.app.request('/types', harness.authorized({}, token))).status).toBe(200);
    }
  });

  it('reads the scheme without regard to case', async () => {
    const response = await harness.app.request('/types', {
      headers: { Authorization: `bearer ${harness.token}` },
    });
    expect(response.status).toBe(200);
  });

  it('refuses a key once it is disabled', async () => {
    const key = await createTestApiKey(harness.auth, 'short-lived');
    expect((await harness.app.request('/types', harness.authorized({}, key))).status).toBe(200);
    const { key: found } = await harness.auth.api.verifyApiKey({ body: { key } });
    const { user } = await harness.auth.api.signInEmail({ body: TEST_ACCOUNT });
    await harness.auth.api.updateApiKey({
      body: { keyId: found?.id ?? '', userId: user.id, enabled: false },
    });
    expect((await harness.app.request('/types', harness.authorized({}, key))).status).toBe(401);
  });

  it.each([
    ['another key', (token: string) => ({ Authorization: `Bearer ${token.slice(0, -4)}zzzz` })],
    ['the start of a key', (token: string) => ({ Authorization: `Bearer ${token.slice(0, -1)}` })],
    ['a key followed by more', (token: string) => ({ Authorization: `Bearer ${token}0` })],
    ['two keys at once', (token: string) => ({ Authorization: `Bearer ${token}, ${token}` })],
    ['no key', () => ({ Authorization: 'Bearer ' })],
    ['the key without a scheme', (token: string) => ({ Authorization: token })],
    ['another scheme', (token: string) => ({ Authorization: `Basic ${token}` })],
    ['the key in another header', (token: string) => ({ 'X-Api-Key': token })],
    ['the key in a cookie', (token: string) => ({ Cookie: `token=${token}` })],
  ])('refuses %s', async (_, headersOf) => {
    const response = await harness.app.request('/types', { headers: headersOf(harness.token) });
    expect(response.status).toBe(401);
  });

  it('refuses a key given in the query string', async () => {
    const response = await harness.app.request(
      `/types?token=${harness.token}&access_token=${harness.token}`,
    );
    expect(response.status).toBe(401);
  });

  it('never writes a presented token in a log line or a response', async () => {
    const presented = 'liasse_synthetic-wrong-token-7f3a';
    const response = await harness.app.request('/types', harness.authorized({}, presented));
    const accepted = await harness.call('/types');
    const written = [await response.text(), await accepted.text(), ...harness.logs()].join('\n');
    expect(written).not.toContain(presented);
    expect(written).not.toContain(harness.token);
    expect(harness.logs().some((line) => line.includes('"status":401'))).toBe(true);
  });
});

describe('requireAny', () => {
  it('asks every credential, whichever accepts', async () => {
    const asked: string[] = [];
    const credential = (name: string, verdict: boolean) => () => {
      asked.push(name);
      return verdict;
    };
    const either = new Hono<AppEnv>()
      .use(requireAny([credential('first', true), credential('second', false)]))
      .get('/', (context) => context.text('in'));
    expect((await either.request('/')).status).toBe(200);
    expect(asked).toEqual(['first', 'second']);
  });
});
