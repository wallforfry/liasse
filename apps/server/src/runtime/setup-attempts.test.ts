import { authUsers } from '@liasse/core/db';
import { FORWARDED_FOR_HEADER } from '@liasse/core/network';
import { SETUP_ATTEMPTS_PER_MINUTE } from '@liasse/core/setup';
import { describe, expect, it } from 'vitest';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';
import { onboardingOf, setupModels } from './setup.test-helper.ts';

const WRONG_TOKEN = 'synthetic-wrong-token';

describe('the limit of attempts at the setup token', () => {
  const harness = useRuntimeHarness();
  const { post, status, codeOf, tokenOf, setupOf } = onboardingOf(harness);

  const attempt = async (
    runtime: Runtime,
    token: string,
    headers: Readonly<Record<string, string>> = {},
  ) => post(runtime, '/api/setup', setupOf(token), headers);

  // Sequential: the count of each attempt is what the next one is judged by.
  const spend = async (runtime: Runtime, headers: Readonly<Record<string, string>> = {}) => {
    const statuses: number[] = [];
    for (let index = 0; index < SETUP_ATTEMPTS_PER_MINUTE; index += 1) {
      statuses.push((await attempt(runtime, WRONG_TOKEN, headers)).status);
    }
    return statuses;
  };
  const allRefused = Array.from({ length: SETUP_ATTEMPTS_PER_MINUTE }, () => 403);

  it('refuses attempts past the limit of a minute from one address, the right token included', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    expect(await spend(runtime)).toEqual(allRefused);
    const refused = await attempt(runtime, tokenOf());
    expect(refused.status).toBe(429);
    expect(await codeOf(refused)).toBe('too_many_attempts');
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await harness.database().db.select().from(authUsers)).toEqual([]);
    expect(await status(runtime)).toEqual({ needs_setup: true });
  });

  it('counts each client a trusted proxy forwards on its own', async () => {
    const runtime = await harness.startUnconfigured(
      { TRUSTED_PROXIES: '127.0.0.1' },
      { models: setupModels },
    );
    const first = { [FORWARDED_FOR_HEADER]: '203.0.113.7' };
    const second = { [FORWARDED_FOR_HEADER]: '198.51.100.9' };
    expect(await spend(runtime, first)).toEqual(allRefused);
    expect((await attempt(runtime, WRONG_TOKEN, first)).status).toBe(429);
    expect((await attempt(runtime, tokenOf(), second)).status).toBe(201);
  });

  it('ignores the forwarded address a socket sends when it is no trusted proxy', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    const statuses: number[] = [];
    for (let index = 0; index < SETUP_ATTEMPTS_PER_MINUTE; index += 1) {
      const forged = { [FORWARDED_FOR_HEADER]: `203.0.113.${String(index + 1)}` };
      statuses.push((await attempt(runtime, WRONG_TOKEN, forged)).status);
    }
    expect(statuses).toEqual(allRefused);
    const forged = { [FORWARDED_FOR_HEADER]: '198.51.100.9' };
    expect((await attempt(runtime, tokenOf(), forged)).status).toBe(429);
  });
});
