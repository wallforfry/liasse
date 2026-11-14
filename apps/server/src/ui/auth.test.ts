import { argon2id } from 'hash-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness, TEST_TOKEN } from '../http/harness.test-helper.ts';
import { loadConfig } from '@liasse/core/config';
import { SYNTHETIC_ENV } from '@liasse/core/testing';
import { createLoginLimit } from './login-limit.ts';
import {
  cookiesOf,
  formRequest,
  openLoginForm,
  setCookieLine,
  signIn,
  submitLogin,
  TEST_CLIENT_HEADER,
  UI_TEST_PASSWORD,
  uiApp,
} from './ui.test-helper.ts';

describe('web UI access', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  describe('login', () => {
    it('opens a session for the right password, in a strict HttpOnly cookie', async () => {
      const response = await submitLogin(uiApp(harness), UI_TEST_PASSWORD);
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe('/ui/documents');
      const line = setCookieLine(response, 'liasse_session') ?? '';
      expect(line).toMatch(/^liasse_session=[A-Za-z0-9_-]{43};/);
      expect(line.split('; ').slice(1).sort()).toEqual(
        ['HttpOnly', 'Max-Age=604800', 'Path=/ui', 'SameSite=Strict', 'Secure'].sort(),
      );
    });

    it('leaves Secure out when PUBLIC_URL is plain http', async () => {
      const response = await submitLogin(
        uiApp(harness, { secureCookies: false }),
        UI_TEST_PASSWORD,
      );
      const line = setCookieLine(response, 'liasse_session') ?? '';
      expect(line).toContain('HttpOnly');
      expect(line).toContain('SameSite=Strict');
      expect(line).not.toContain('Secure');
    });

    it('refuses a wrong password without opening a session', async () => {
      const response = await submitLogin(uiApp(harness), 'synthetic-wrong-password');
      expect(response.status).toBe(401);
      expect(await response.text()).toContain('Wrong password.');
      expect(cookiesOf(response).liasse_session).toBeUndefined();
    });

    it('refuses a login form that was not loaded by this browser', async () => {
      const app = uiApp(harness);
      const form = await openLoginForm(app);
      const other = await openLoginForm(app);
      const response = await app.request(
        '/ui/login',
        formRequest({ csrf: other.token, password: UI_TEST_PASSWORD }, form.cookie),
      );
      expect(response.status).toBe(403);
      expect(cookiesOf(response).liasse_session).toBeUndefined();
      const withoutCookie = await app.request(
        '/ui/login',
        formRequest({ csrf: form.token, password: UI_TEST_PASSWORD }, ''),
      );
      expect(withoutCookie.status).toBe(403);
    });

    it('accepts the password of an argon2id hash, and only that one', async () => {
      const hash = await argon2id({
        password: 'synthetic-hashed-password',
        salt: new Uint8Array(16).fill(7),
        memorySize: 64,
        iterations: 1,
        parallelism: 1,
        hashLength: 32,
        outputType: 'encoded',
      });
      const password = loadConfig({ ...SYNTHETIC_ENV, UI_PASSWORD: hash }).auth.ui?.password;
      expect(password?.kind).toBe('argon2id');
      if (password === undefined) return;
      const app = uiApp(harness, { password });
      expect((await submitLogin(app, 'synthetic-hashed-password')).status).toBe(303);
      expect((await submitLogin(app, 'synthetic-other-password')).status).toBe(401);
    });

    it('admits five attempts a minute per address, then answers 429', async () => {
      const clock = { now: 1_000_000 };
      const app = uiApp(harness, { loginLimit: createLoginLimit({ now: () => clock.now }) });
      const attempt = (client: string, password = 'synthetic-wrong-password') =>
        submitLogin(app, password, { [TEST_CLIENT_HEADER]: client });
      const statuses = [];
      for (let index = 0; index < 5; index += 1) statuses.push((await attempt('client-b')).status);
      expect(statuses).toEqual([401, 401, 401, 401, 401]);
      const refused = await attempt('client-b', UI_TEST_PASSWORD);
      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toBe('60');
      expect(cookiesOf(refused).liasse_session).toBeUndefined();
      expect((await attempt('client-c')).status).toBe(401);
      clock.now += 60_000;
      expect((await attempt('client-b', UI_TEST_PASSWORD)).status).toBe(303);
    });
  });

  describe('sessions', () => {
    it('sends a request without a session to the login page', async () => {
      const app = uiApp(harness);
      const response = await app.request('/ui/documents');
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe('/ui/login');
      const forged = await app.request('/ui/documents', {
        headers: { Cookie: 'liasse_session=synthetic-forged-session-token' },
      });
      expect(forged.status).toBe(303);
    });

    it('ends the session at logout', async () => {
      const app = uiApp(harness);
      const session = await signIn(app);
      expect((await session.get('/ui/documents')).status).toBe(200);
      const response = await session.post('/ui/logout', {});
      expect(response.status).toBe(303);
      expect(setCookieLine(response, 'liasse_session')).toMatch(/Max-Age=0/);
      expect((await session.get('/ui/documents')).status).toBe(303);
    });

    it('ends the session when its lifetime is over', async () => {
      const clock = { now: 2_000_000 };
      const app = uiApp(harness, { sessionTtlMs: 1000, now: () => clock.now });
      const session = await signIn(app);
      clock.now += 1000;
      expect((await session.get('/ui/documents')).status).toBe(303);
    });

    it('keeps the UI and the API credentials apart', async () => {
      const app = uiApp(harness);
      const session = await signIn(app);
      const api = await app.request('/documents', { headers: { Cookie: session.cookie } });
      expect(api.status).toBe(401);
      const ui = await app.request('/ui/documents', {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` },
      });
      expect(ui.status).toBe(303);
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
      expect((await harness.app.request('/ui/login')).status).toBe(404);
      expect((await harness.app.request('/ui/documents')).status).toBe(404);
    });
  });

  describe('CSRF', () => {
    it.each(['/ui/logout', '/ui/upload', '/ui/documents/doc_0000', '/ui/changes/chg_0000'])(
      'refuses a form to %s without the token of its session',
      async (path) => {
        const app = uiApp(harness);
        const session = await signIn(app);
        const forged = await app.request(path, formRequest({ csrf: 'forged' }, session.cookie));
        expect(forged.status).toBe(403);
        const missing = await app.request(path, formRequest({}, session.cookie));
        expect(missing.status).toBe(403);
        const other = await signIn(app);
        const crossed = await app.request(path, formRequest({ csrf: other.csrf }, session.cookie));
        expect(crossed.status).toBe(403);
        expect((await session.get('/ui/documents')).status).toBe(200);
      },
    );
  });
});
