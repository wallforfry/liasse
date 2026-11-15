import { CLIENT_ADDRESS_HEADER, SIGN_IN_ATTEMPTS_PER_MINUTE } from '@liasse/core/auth';
import { FORWARDED_FOR_HEADER, parseSubnet, type Subnet } from '@liasse/core/network';
import { TEST_ACCOUNT } from '@liasse/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Listener, listen } from '../../runtime/listen.ts';
import { createHttpHarness, type HttpHarness } from '../harness.test-helper.ts';
import { newClient, signInRequest, withHeaders } from '../ui/ui.test-helper.ts';

const LOOPBACK: readonly Subnet[] = ['127.0.0.1', '::1'].flatMap((value) => {
  const subnet = parseSubnet(value);
  return subnet === undefined ? [] : [subnet];
});

const WRONG_PASSWORD = 'synthetic-wrong-password';

describe('the sign-in rate limit', () => {
  let harness: HttpHarness;
  let listener: Listener;
  // The same application, with the loopback address trusted as a reverse proxy.
  let behindProxy: Listener;

  beforeAll(async () => {
    harness = await createHttpHarness();
    listener = await listen({ fetch: harness.app.fetch, host: '127.0.0.1', port: 0 });
    const proxied = harness.appWith({ trustedProxies: { subnets: LOOPBACK, cloudflare: false } });
    behindProxy = await listen({ fetch: proxied.fetch, host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await behindProxy.close(0);
    await listener.close(0);
    await harness.dispose();
  });

  const signIn = async (
    to: Listener,
    password: string,
    headers: Readonly<Record<string, string>> = {},
  ) =>
    fetch(
      `http://127.0.0.1:${String(to.port)}/api/auth/sign-in/email`,
      withHeaders(signInRequest(TEST_ACCOUNT.email, password), headers),
    );

  const overSocket = async (password: string, headers: Readonly<Record<string, string>> = {}) =>
    signIn(listener, password, headers);

  // The test plays the proxy: it appends the address of the client it was connected from.
  const forwardedFor = async (chain: string, password: string) =>
    signIn(behindProxy, password, { [FORWARDED_FOR_HEADER]: chain });

  it('refuses the sixth attempt of a minute from one socket address, whatever it claims', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS_PER_MINUTE; attempt += 1) {
      statuses.push((await overSocket(WRONG_PASSWORD)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    const sixth = await overSocket(TEST_ACCOUNT.password);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('X-Retry-After'))).toBeGreaterThan(0);
    const disguised = await overSocket(TEST_ACCOUNT.password, {
      [CLIENT_ADDRESS_HEADER]: '203.0.113.9',
      'X-Forwarded-For': '203.0.113.10',
      'X-Real-IP': '203.0.113.11',
    });
    expect(disguised.status).toBe(429);
    const elsewhere = await harness.app.request(
      '/api/auth/sign-in/email',
      signInRequest(TEST_ACCOUNT.email, TEST_ACCOUNT.password),
      newClient(),
    );
    expect(elsewhere.status).toBe(200);
  });

  it('counts apart two clients behind a trusted proxy, whatever they prepend', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS_PER_MINUTE; attempt += 1) {
      statuses.push((await forwardedFor('192.0.2.21', WRONG_PASSWORD)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401]);
    expect((await forwardedFor('192.0.2.21', TEST_ACCOUNT.password)).status).toBe(429);
    const prepended = await forwardedFor('192.0.2.22, 192.0.2.21', TEST_ACCOUNT.password);
    expect(prepended.status).toBe(429);
    expect((await forwardedFor('192.0.2.22', TEST_ACCOUNT.password)).status).toBe(200);
  });
});
