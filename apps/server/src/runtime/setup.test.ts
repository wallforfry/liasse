import { setupResultSchema, settingsCheckSchema } from '@liasse/contract';
import { authUsers, settings as settingsTable } from '@liasse/core/db';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@liasse/contract/domain';
import { insertSyntheticDocument, signInOverHttp, SYNTHETIC_SETTINGS } from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { useRuntimeHarness } from './runtime.test-helper.ts';
import { onboardingOf, SETUP_ACCOUNT, setupModels } from './setup.test-helper.ts';

describe('the onboarding of a server without an account', () => {
  const harness = useRuntimeHarness();
  // The harness creates the test account for `call`: these requests go without it.
  const { urlOf, post, status, codeOf, onboardingUrl, printedTokens, tokenOf, setupOf } =
    onboardingOf(harness);

  it('prints a new token and the onboarding URL at each start, and none once an account exists', async () => {
    const first = await harness.startUnconfigured({}, { models: setupModels });
    expect(onboardingUrl()).toBe(`${harness.configOf().server.publicUrl}/ui/`);
    expect(Buffer.from(tokenOf(), 'base64url')).toHaveLength(32);
    expect(await status(first)).toEqual({ needs_setup: true });
    await first.stop();
    const second = await harness.startUnconfigured({}, { models: setupModels });
    const [before, after] = printedTokens();
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect((await post(second, '/api/setup', setupOf(before ?? ''))).status).toBe(403);
    await harness.apiKey(second);
    await second.stop();
    const third = await harness.startUnconfigured({}, { models: setupModels });
    expect(printedTokens()).toHaveLength(2);
    expect(await status(third)).toEqual({ needs_setup: false });
  });

  it('refuses a wrong token, and checks settings without saving them with the right one', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
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
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
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
      { email: 'owner@example.com', name: SETUP_ACCOUNT.name },
    ]);
    const cookie = await signInOverHttp({
      baseUrl: urlOf(runtime, ''),
      publicUrl: harness.configOf().server.publicUrl,
      account: { email: 'owner@example.com', password: SETUP_ACCOUNT.password },
    });
    // Applied without a restart: the routes of the API no longer answer 503.
    const types = await fetch(urlOf(runtime, '/types'), {
      headers: { Cookie: cookie, Origin: harness.configOf().server.publicUrl },
    });
    expect(types.status).toBe(200);
    const again = await post(
      runtime,
      '/api/setup',
      setupOf(tokenOf(), { ...SETUP_ACCOUNT, email: 'other@example.com' }),
    );
    expect(again.status).toBe(409);
    expect(await codeOf(again)).toBe('setup_done');
    expect(
      (await post(runtime, '/api/setup/check', { token: tokenOf(), settings: SYNTHETIC_SETTINGS }))
        .status,
    ).toBe(409);
  });

  it('lets one of concurrent setups create the account, and refuses the others', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    const token = tokenOf();
    const emails = ['one@example.com', 'two@example.com', 'three@example.com'];
    const responses = await Promise.all(
      emails.map((email) =>
        post(runtime, '/api/setup', setupOf(token, { ...SETUP_ACCOUNT, email })),
      ),
    );
    expect(responses.map(({ status: code }) => code).toSorted()).toEqual([201, 409, 409]);
    expect(await harness.database().db.select().from(authUsers)).toHaveLength(1);
    expect(
      await harness.database().db.select({ version: settingsTable.version }).from(settingsTable),
    ).toEqual([{ version: 1 }]);
  });

  it('refuses a password the auth server would refuse, and creates no account', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    const lengths = [MIN_PASSWORD_LENGTH - 1, MAX_PASSWORD_LENGTH + 1];
    const responses = await Promise.all(
      lengths.map((length) =>
        post(
          runtime,
          '/api/setup',
          setupOf(tokenOf(), { ...SETUP_ACCOUNT, password: 'p'.repeat(length) }),
        ),
      ),
    );
    expect(responses.map(({ status: code }) => code)).toEqual([400, 400]);
    expect(await harness.database().db.select().from(authUsers)).toEqual([]);
    expect(await harness.database().db.select().from(settingsTable)).toEqual([]);
  });

  it('keeps the embedder of earlier settings while a document is live', async () => {
    const remote = {
      provider: 'ollama',
      model: 'embedding-model',
      base_url: 'http://127.0.0.1:9',
    } as const;
    await harness.saveSettings({ embedding: remote });
    await insertSyntheticDocument(harness.database().db, { status: 'indexed' });
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    const changed = await post(
      runtime,
      '/api/setup',
      setupOf(tokenOf(), SETUP_ACCOUNT, {
        ...SYNTHETIC_SETTINGS,
        embedding: { ...remote, model: 'other-embedding-model' },
      }),
    );
    expect(changed.status).toBe(409);
    expect(await codeOf(changed)).toBe('embedder_locked');
    expect(await harness.database().db.select().from(authUsers)).toEqual([]);
    const kept = await post(
      runtime,
      '/api/setup',
      setupOf(tokenOf(), SETUP_ACCOUNT, { ...SYNTHETIC_SETTINGS, embedding: remote }),
    );
    expect(kept.status).toBe(201);
  });

  it('writes the setup token in one log line only, whatever the requests that carry it', async () => {
    const runtime = await harness.startUnconfigured({}, { models: setupModels });
    const token = tokenOf();
    await post(runtime, '/api/setup/check', { token, settings: SYNTHETIC_SETTINGS });
    await post(runtime, '/api/setup', setupOf(token, { ...SETUP_ACCOUNT, password: 'short' }));
    expect((await post(runtime, '/api/setup', setupOf(token))).status).toBe(201);
    await post(runtime, '/api/setup', setupOf(token));
    expect(harness.lines().filter((line) => line.includes(token))).toHaveLength(1);
  });
});
