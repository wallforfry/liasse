import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearerToken, requireAny } from './auth.ts';
import type { AppEnv } from './env.ts';
import {
  authorized,
  createHttpHarness,
  type HttpHarness,
  OTHER_TEST_TOKEN,
  TEST_TOKEN,
} from './harness.test-helper.ts';

const PUBLIC_ROUTES = ['GET /health'];

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

  it('refuses every route but /health without a credential', async () => {
    const guarded = routes().filter(
      ({ method, path }) => !PUBLIC_ROUTES.includes(`${method} ${path}`),
    );
    expect(guarded.length).toBeGreaterThanOrEqual(16);
    for (const { method, path } of guarded) {
      const response = await harness.app.request(exampleOf(path), { method });
      expect([method, path, response.status]).toEqual([method, path, 401]);
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="liasse"');
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

  it.each([TEST_TOKEN, OTHER_TEST_TOKEN])('accepts the configured token %s', async (token) => {
    const response = await harness.app.request('/types', authorized({}, token));
    expect(response.status).toBe(200);
  });

  it('reads the scheme without regard to case', async () => {
    const response = await harness.app.request('/types', {
      headers: { Authorization: `bearer ${TEST_TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ['another token', { Authorization: 'Bearer synthetic-token-9999' }],
    ['the start of a token', { Authorization: `Bearer ${TEST_TOKEN.slice(0, -1)}` }],
    ['a token followed by more', { Authorization: `Bearer ${TEST_TOKEN}0` }],
    ['two tokens at once', { Authorization: `Bearer ${TEST_TOKEN}, ${OTHER_TEST_TOKEN}` }],
    ['no token', { Authorization: 'Bearer ' }],
    ['the token without a scheme', { Authorization: TEST_TOKEN }],
    ['another scheme', { Authorization: `Basic ${TEST_TOKEN}` }],
    ['the token in another header', { 'X-Api-Key': TEST_TOKEN }],
    ['the token in a cookie', { Cookie: `token=${TEST_TOKEN}` }],
  ])('refuses %s', async (_, headers) => {
    const response = await harness.app.request('/types', { headers });
    expect(response.status).toBe(401);
  });

  it('refuses a token given in the query string', async () => {
    const response = await harness.app.request(
      `/types?token=${TEST_TOKEN}&access_token=${TEST_TOKEN}`,
    );
    expect(response.status).toBe(401);
  });

  it('never writes a presented token in a log line or a response', async () => {
    const presented = 'synthetic-wrong-token-7f3a';
    const response = await harness.app.request('/types', authorized({}, presented));
    const accepted = await harness.call('/types');
    const written = [await response.text(), await accepted.text(), ...harness.logs()].join('\n');
    expect(written).not.toContain(presented);
    expect(written).not.toContain(TEST_TOKEN);
    expect(harness.logs().some((line) => line.includes('"status":401'))).toBe(true);
  });
});

describe('bearerToken', () => {
  const comparisons: (readonly [number, number])[] = [];
  const recording = (left: Uint8Array, right: Uint8Array): boolean => {
    comparisons.push([left.byteLength, right.byteLength]);
    return timingSafeEqual(left, right);
  };
  const tokens = ['synthetic-token-aaaa', 'synthetic-token-bbbb-longer', 'synthetic-token-cccc'];
  const app = new Hono<AppEnv>()
    .use(requireAny([bearerToken(tokens, recording)]))
    .get('/', (context) => context.text('in'));

  const statusWith = async (authorization: string | undefined): Promise<number> => {
    comparisons.length = 0;
    const response = await app.request('/', {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    });
    return response.status;
  };

  // What the time taken could tell: how many tokens there are, their length, and which
  // one matched. Every request makes the same comparisons over the same sizes.
  it.each([
    ['the first token', `Bearer ${tokens[0] ?? ''}`, 200],
    ['the last token', `Bearer ${tokens[2] ?? ''}`, 200],
    ['a wrong token', 'Bearer synthetic-token-zzzz', 401],
    ['a very long token', `Bearer ${'z'.repeat(10_000)}`, 401],
    ['an empty token', 'Bearer ', 401],
    ['no header', undefined, 401],
  ])('compares %s with every configured token, over 32 bytes each', async (_, header, status) => {
    expect(await statusWith(header)).toBe(status);
    expect(comparisons).toEqual([
      [32, 32],
      [32, 32],
      [32, 32],
    ]);
  });

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
