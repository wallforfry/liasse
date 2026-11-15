import { CLIENT_ADDRESS_HEADER, SIGN_IN_ATTEMPTS_PER_MINUTE } from '@liasse/core/auth';
import { TEST_ACCOUNT } from '@liasse/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Listener, listen } from '../../runtime/listen.ts';
import { createHttpHarness, type HttpHarness } from '../harness.test-helper.ts';
import { newClient, signInRequest, withHeaders } from '../ui/ui.test-helper.ts';

describe('the sign-in rate limit', () => {
  let harness: HttpHarness;
  let listener: Listener;

  beforeAll(async () => {
    harness = await createHttpHarness();
    listener = await listen({ fetch: harness.app.fetch, host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await listener.close(0);
    await harness.dispose();
  });

  const overSocket = async (password: string, headers: Readonly<Record<string, string>> = {}) =>
    fetch(
      `http://127.0.0.1:${String(listener.port)}/api/auth/sign-in/email`,
      withHeaders(signInRequest(TEST_ACCOUNT.email, password), headers),
    );

  it('refuses the sixth attempt of a minute from one socket address, whatever it claims', async () => {
    const statuses = [];
    for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS_PER_MINUTE; attempt += 1) {
      statuses.push((await overSocket('synthetic-wrong-password')).status);
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
});
