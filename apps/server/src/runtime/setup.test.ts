import {
  setupResultSchema,
  setupStatusSchema,
  settingsCheckSchema,
  type SetupRequestInput,
} from '@liasse/contract';
import { authUsers, settings as settingsTable } from '@liasse/core/db';
import { SETUP_ATTEMPTS_PER_MINUTE } from '@liasse/core/setup';
import { createFakeModelFactories, signInOverHttp, SYNTHETIC_SETTINGS } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Runtime } from './create-runtime.ts';
import { useRuntimeHarness } from './runtime.test-helper.ts';

const models = createFakeModelFactories();
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const TOKEN_LINE =
  /^Notice: no account exists yet\. Open (\S+) to create the first one, with this setup token: (\S+) \(/;

const ACCOUNT = {
  name: 'Synthetic Owner',
  email: 'Owner@Example.com',
  password: 'synthetic-owner-password',
} as const;

describe('the onboarding of a server without an account', () => {
  const harness = useRuntimeHarness();

  // The harness creates the test account for `call`: these requests go without it.
  const urlOf = (runtime: Runtime, path: string): string =>
    `http://127.0.0.1:${String(runtime.port)}${path}`;
  const post = async (runtime: Runtime, path: string, body: unknown) =>
    fetch(urlOf(runtime, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const status = async (runtime: Runtime) =>
    setupStatusSchema.parse(await (await fetch(urlOf(runtime, '/api/setup'))).json());
  const codeOf = async (response: Response) => errorSchema.parse(await response.json()).error.code;

  const printedTokens = (): readonly string[] =>
    harness.lines().flatMap((line) => {
      const [, , token] = TOKEN_LINE.exec(line) ?? [];
      return token === undefined ? [] : [token];
    });
  const tokenOf = (): string => {
    const token = printedTokens().at(-1);
    if (token === undefined) throw new Error('the server printed no setup token');
    return token;
  };

  const setupOf = (token: string, account: SetupRequestInput['account'] = ACCOUNT) => ({
    token,
    account,
    settings: SYNTHETIC_SETTINGS,
  });

  it('prints a new token and the onboarding URL at each start, and none once an account exists', async () => {
    const first = await harness.startUnconfigured({}, { models });
    const [line] = harness.lines().filter((candidate) => TOKEN_LINE.test(candidate));
    expect(TOKEN_LINE.exec(line ?? '')?.[1]).toBe(`${harness.configOf().server.publicUrl}/ui/`);
    expect(Buffer.from(tokenOf(), 'base64url')).toHaveLength(32);
    expect(await status(first)).toEqual({ needs_setup: true });
    await first.stop();
    const second = await harness.startUnconfigured({}, { models });
    const [before, after] = printedTokens();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect((await post(second, '/api/setup', setupOf(before ?? ''))).status).toBe(403);
    await harness.apiKey(second);
    await second.stop();
    const third = await harness.startUnconfigured({}, { models });
    expect(printedTokens()).toHaveLength(2);
    expect(await status(third)).toEqual({ needs_setup: false });
  });

  it('refuses a wrong token, and checks settings without saving them with the right one', async () => {
    const runtime = await harness.startUnconfigured({}, { models });
    const wrong = await post(runtime, '/api/setup/check', {
      token: 'synthetic-wrong-token',
      settings: SYNTHETIC_SETTINGS,
    });
    expect(wrong.status).toBe(403);
    expect(await codeOf(wrong)).toBe('invalid_setup_token');
    expect((await post(runtime, '/api/setup', setupOf('synthetic-wrong-token'))).status).toBe(403);
    const checked = await post(runtime, '/api/setup/check', {
      token: tokenOf(),
      settings: SYNTHETIC_SETTINGS,
    });
    expect(checked.status).toBe(200);
    expect(settingsCheckSchema.parse(await checked.json()).text_model).toEqual({ status: 'ok' });
    expect(await harness.database().db.select().from(settingsTable)).toEqual([]);
    expect(await harness.database().db.select().from(authUsers)).toEqual([]);
  });

  it('creates the account, saves and applies the settings, then refuses another setup', async () => {
    const runtime = await harness.startUnconfigured({}, { models });
    expect((await fetch(urlOf(runtime, '/types'))).status).toBe(401);
    const created = await post(runtime, '/api/setup', setupOf(tokenOf()));
    expect(created.status).toBe(201);
    const result = setupResultSchema.parse(await created.json());
    expect(result.email).toBe('owner@example.com');
    expect(result.settings.version).toBe(1);
    expect(result.settings.settings?.llm.text_model).toBe(SYNTHETIC_SETTINGS.llm.text_model);
    expect(await status(runtime)).toEqual({ needs_setup: false });
    const users = await harness.database().db.select().from(authUsers);
    expect(users.map(({ email, name }) => ({ email, name }))).toEqual([
      { email: 'owner@example.com', name: ACCOUNT.name },
    ]);
    const cookie = await signInOverHttp({
      baseUrl: urlOf(runtime, ''),
      publicUrl: harness.configOf().server.publicUrl,
      account: { email: 'owner@example.com', password: ACCOUNT.password },
    });
    // Applied without a restart: the routes of the API no longer answer 503.
    const types = await fetch(urlOf(runtime, '/types'), {
      headers: { Cookie: cookie, Origin: harness.configOf().server.publicUrl },
    });
    expect(types.status).toBe(200);
    const again = await post(
      runtime,
      '/api/setup',
      setupOf(tokenOf(), { ...ACCOUNT, email: 'other@example.com' }),
    );
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe('setup_done');
    expect(
      (await post(runtime, '/api/setup/check', { token: tokenOf(), settings: SYNTHETIC_SETTINGS }))
        .status,
    ).toBe(409);
  });

  it('lets one of concurrent setups create the account, and refuses the others', async () => {
    const runtime = await harness.startUnconfigured({}, { models });
    const token = tokenOf();
    const emails = ['one@example.com', 'two@example.com', 'three@example.com'];
    const responses = await Promise.all(
      emails.map((email) => post(runtime, '/api/setup', setupOf(token, { ...ACCOUNT, email }))),
    );
    expect(responses.map(({ status: code }) => code).toSorted()).toEqual([201, 409, 409]);
    expect(await harness.database().db.select().from(authUsers)).toHaveLength(1);
    expect(
      await harness.database().db.select({ version: settingsTable.version }).from(settingsTable),
    ).toEqual([{ version: 1 }]);
  });

  it('refuses attempts past the limit of a minute from one address, the right token included', async () => {
    const runtime = await harness.startUnconfigured({}, { models });
    const statuses = [];
    for (let attempt = 0; attempt < SETUP_ATTEMPTS_PER_MINUTE; attempt += 1) {
      statuses.push((await post(runtime, '/api/setup', setupOf('synthetic-wrong-token'))).status);
    }
    expect(statuses).toEqual(Array.from({ length: SETUP_ATTEMPTS_PER_MINUTE }, () => 403));
    const refused = await post(runtime, '/api/setup', setupOf(tokenOf()));
    expect(refused.status).toBe(429);
    expect(await codeOf(refused)).toBe('too_many_attempts');
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await harness.database().db.select().from(authUsers)).toEqual([]);
    expect(await status(runtime)).toEqual({ needs_setup: true });
  });
});
