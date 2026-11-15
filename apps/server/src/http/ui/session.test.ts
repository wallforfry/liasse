import { loadConfig } from '@liasse/core/config';
import { createGate, sleep, SYNTHETIC_ENV, waitUntil } from '@liasse/core/testing';
import { argon2id } from 'hash-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness, TEST_TOKEN } from '../harness.test-helper.ts';
import { createLoginLimit } from './login-limit.ts';
import { createPasswordCheck } from './password.ts';
import {
  cookiesOf,
  logIn,
  setCookieLine,
  signIn,
  TEST_CLIENT_HEADER,
  UI_TEST_PASSWORD,
  uiApp,
} from './ui.test-helper.ts';

const errorCodeOf = async (response: Response): Promise<string> =>
  z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code;

const hashOf = async (password: string, fill: number): Promise<string> =>
  argon2id({
    password,
    salt: new Uint8Array(16).fill(fill),
    memorySize: 64,
    iterations: 1,
    parallelism: 1,
    hashLength: 32,
    outputType: 'encoded',
  });

const argon2Password = async (password: string, fill: number) => {
  const configured = loadConfig({ ...SYNTHETIC_ENV, UI_PASSWORD: await hashOf(password, fill) });
  const value = configured.auth.ui?.password;
  if (value === undefined) throw new Error('expected a UI password');
  return value;
};

describe('the session of the web UI', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  describe('POST /ui/session', () => {
    it('opens a session for the right password, in a strict HttpOnly cookie for every path', async () => {
      const response = await logIn(uiApp(harness), UI_TEST_PASSWORD);
      expect(response.status).toBe(200);
      const body = z.strictObject({ csrf_token: z.string() }).parse(await response.json());
      expect(body.csrf_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const line = setCookieLine(response, 'liasse_session') ?? '';
      expect(line).toMatch(/^liasse_session=[A-Za-z0-9_-]{43};/);
      expect(line.split('; ').slice(1).sort()).toEqual(
        ['HttpOnly', 'Max-Age=604800', 'Path=/', 'SameSite=Strict', 'Secure'].sort(),
      );
    });

    it('leaves Secure out when PUBLIC_URL is plain http', async () => {
      const response = await logIn(uiApp(harness, { secureCookies: false }), UI_TEST_PASSWORD);
      const line = setCookieLine(response, 'liasse_session') ?? '';
      expect(line).toContain('HttpOnly');
      expect(line).toContain('SameSite=Strict');
      expect(line).not.toContain('Secure');
    });

    it('refuses a wrong password without opening a session', async () => {
      const response = await logIn(uiApp(harness), 'synthetic-wrong-password');
      expect(response.status).toBe(401);
      expect(await errorCodeOf(response)).toBe('wrong_password');
      expect(cookiesOf(response).liasse_session).toBeUndefined();
    });

    it('accepts JSON only, so a cross-site form cannot log a browser in', async () => {
      const response = await uiApp(harness).request('/ui/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: UI_TEST_PASSWORD }).toString(),
      });
      expect(response.status).toBe(415);
      expect(cookiesOf(response).liasse_session).toBeUndefined();
    });

    it('accepts the password of an argon2id hash, and only that one', async () => {
      const app = uiApp(harness, { password: await argon2Password('synthetic-hashed', 7) });
      expect((await logIn(app, 'synthetic-hashed')).status).toBe(200);
      expect((await logIn(app, 'synthetic-other')).status).toBe(401);
    });

    it('answers 503 without hashing while two argon2id hashes are in flight', async () => {
      const gate = createGate();
      const hashed: string[] = [];
      const password = await argon2Password('synthetic-held-password', 3);
      const app = uiApp(harness, {
        checkPassword: createPasswordCheck(password, {
          hash: async (presented) => {
            hashed.push(presented);
            await gate.opened;
            return new Uint8Array(32);
          },
        }),
      });
      const attempt = (client: string) =>
        logIn(app, `synthetic-${client}`, { [TEST_CLIENT_HEADER]: client });
      const first = attempt('client-h1');
      const second = attempt('client-h2');
      await waitUntil(() => hashed.length === 2);
      // Bounded, so a missing cap fails at once instead of waiting on the held hashes.
      const third = await Promise.race([attempt('client-h3'), sleep(5000).then(() => undefined)]);
      expect(third?.status).toBe(503);
      expect(third?.headers.get('Retry-After')).toBe('1');
      expect(third === undefined ? undefined : cookiesOf(third).liasse_session).toBeUndefined();
      expect(hashed).toEqual(['synthetic-client-h1', 'synthetic-client-h2']);
      gate.open();
      expect((await Promise.all([first, second])).map(({ status }) => status)).toEqual([401, 401]);
    });

    it('admits five attempts a minute per address, then answers 429', async () => {
      const clock = { now: 1_000_000 };
      const app = uiApp(harness, { loginLimit: createLoginLimit({ now: () => clock.now }) });
      const attempt = (client: string, password = 'synthetic-wrong-password') =>
        logIn(app, password, { [TEST_CLIENT_HEADER]: client });
      const statuses = [];
      for (let index = 0; index < 5; index += 1) statuses.push((await attempt('client-b')).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401]);
      const refused = await attempt('client-b', UI_TEST_PASSWORD);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toBe('60');
      expect(cookiesOf(refused).liasse_session).toBeUndefined();
      expect((await attempt('client-c')).status).toBe(401);
      clock.now += 60_000;
      expect((await attempt('client-b', UI_TEST_PASSWORD)).status).toBe(200);
    });
  });

  describe('GET and DELETE /ui/session', () => {
    it('reads the CSRF token of a live session, and 401 without one', async () => {
      const app = uiApp(harness);
      const session = await signIn(app);
      const live = await session.request('/ui/session', {}, false);
      expect(live.status).toBe(200);
      expect(await live.json()).toEqual({ csrf_token: session.csrf });
      expect((await app.request('/ui/session')).status).toBe(401);
      const forged = await app.request('/ui/session', {
        headers: { Cookie: 'liasse_session=synthetic-forged-session-token' },
      });
      expect(forged.status).toBe(401);
    });

    it('logs out with the CSRF token only, and ends the session for good', async () => {
      const app = uiApp(harness);
      const session = await signIn(app);
      const forged = await session.request('/ui/session', { method: 'DELETE' }, false);
      expect(forged.status).toBe(403);
      expect(await errorCodeOf(forged)).toBe('csrf_refused');
      const response = await session.request('/ui/session', { method: 'DELETE' });
      expect(response.status).toBe(204);
      expect(setCookieLine(response, 'liasse_session')).toMatch(/Max-Age=0.*Path=\//);
      expect((await session.request('/ui/session')).status).toBe(401);
      expect((await session.request('/documents')).status).toBe(401);
    });

    it('ends the previous session of a browser that logs in again', async () => {
      const app = uiApp(harness);
      const first = await signIn(app);
      const again = await logIn(app, UI_TEST_PASSWORD, { Cookie: first.cookie });
      expect(again.status).toBe(200);
      const second = cookiesOf(again).liasse_session ?? '';
      expect(second).not.toBe(first.cookie);
      expect((await first.request('/ui/session')).status).toBe(401);
      expect((await app.request('/ui/session', { headers: { Cookie: second } })).status).toBe(200);
    });

    it('ends the session when its lifetime is over', async () => {
      const clock = { now: 2_000_000 };
      const app = uiApp(harness, { sessionTtlMs: 1000, now: () => clock.now });
      const session = await signIn(app);
      expect((await session.request('/documents')).status).toBe(200);
      clock.now += 1000;
      expect((await session.request('/ui/session')).status).toBe(401);
      expect((await session.request('/documents')).status).toBe(401);
    });
  });

  it('stays out of the OpenAPI contract', async () => {
    const response = await uiApp(harness).request('/openapi.json', {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    const contract = z.object({ paths: z.record(z.string(), z.unknown()) });
    const paths = Object.keys(contract.parse(await response.json()).paths);
    expect(paths).toContain('/documents');
    expect(paths.filter((path) => path === '/' || path.startsWith('/ui'))).toEqual([]);
  });

  it('is not mounted when UI_PASSWORD is unset', async () => {
    expect((await harness.app.request('/ui/session')).status).toBe(404);
    expect((await harness.app.request('/ui/documents')).status).toBe(404);
    const root = await harness.app.request('/');
    expect(root.status).toBe(404);
    expect(root.headers.get('Location')).toBeNull();
  });
});
