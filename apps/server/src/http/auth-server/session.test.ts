import { createAuth } from '@liasse/core/auth';
import { TEST_ACCOUNT, TEST_AUTH_SECRET } from '@liasse/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createHttpHarness,
  type HttpHarness,
  jsonRequest,
  TEST_PUBLIC_URL,
} from '../harness.test-helper.ts';
import {
  cookiesOf,
  fromUi,
  newClient,
  SECURE_SESSION_COOKIE,
  setCookieLine,
  signIn,
  signInRequest,
  withHeaders,
} from '../ui/ui.test-helper.ts';

const errorCodeOf = async (response: Response): Promise<string> =>
  z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code;

const MISSING_DOCUMENT = '/documents/doc_00000000000000000000000000';

describe('the session of the web UI', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  describe('POST /api/auth/sign-in/email', () => {
    it('opens a session in a strict, HttpOnly, Secure cookie for every path', async () => {
      const response = await harness.app.request(
        '/api/auth/sign-in/email',
        signInRequest(TEST_ACCOUNT.email, TEST_ACCOUNT.password),
        newClient(),
      );
      expect(response.status).toBe(200);
      const line = setCookieLine(response, SECURE_SESSION_COOKIE) ?? '';
      const attributes = line.split('; ').slice(1);
      expect(attributes).toEqual(
        expect.arrayContaining(['HttpOnly', 'Path=/', 'SameSite=Strict', 'Secure']),
      );
      expect(attributes).toContain('Max-Age=604800');
    });

    it('refuses a wrong password without opening a session', async () => {
      const response = await harness.app.request(
        '/api/auth/sign-in/email',
        signInRequest(TEST_ACCOUNT.email, 'synthetic-wrong-password'),
        newClient(),
      );
      expect(response.status).toBe(401);
      expect(cookiesOf(response)[SECURE_SESSION_COOKIE]).toBeUndefined();
    });

    it('has no public sign-up', async () => {
      const response = await harness.app.request(
        '/api/auth/sign-up/email',
        fromUi(
          jsonRequest('POST', {
            name: 'new',
            email: 'new@example.com',
            password: 'synthetic-new-password',
          }),
        ),
      );
      expect(response.status).toBe(400);
      const signIn = await harness.app.request(
        '/api/auth/sign-in/email',
        signInRequest('new@example.com', 'synthetic-new-password'),
        newClient(),
      );
      expect(signIn.status).toBe(401);
    });
  });

  describe('the REST API with the cookie', () => {
    it('accepts the cookie alone on GET, HEAD and the original file', async () => {
      const id = await harness.addDocument(['synthetic page']);
      const session = await signIn(harness.app);
      expect((await session.request('/documents', {}, false)).status).toBe(200);
      expect((await session.request(`/documents/${id}`, {}, false)).status).toBe(200);
      expect((await session.request('/types', { method: 'HEAD' }, false)).status).toBe(200);
    });

    it.each([
      ['POST', '/search', jsonRequest('POST', { query: 'synthetic' })],
      ['PATCH', MISSING_DOCUMENT, jsonRequest('PATCH', { private: true })],
      ['DELETE', MISSING_DOCUMENT, { method: 'DELETE' }],
    ])('refuses %s without the Origin of PUBLIC_URL', async (_, path, init) => {
      const session = await signIn(harness.app);
      const missing = await session.request(path, init, false);
      expect(missing.status).toBe(403);
      expect(await errorCodeOf(missing)).toBe('origin_refused');
      const foreign = await session.request(
        path,
        withHeaders(init, { Origin: 'https://attacker.example.net' }),
        false,
      );
      expect(foreign.status).toBe(403);
      const sent = await session.request(path, init);
      expect([401, 403]).not.toContain(sent.status);
    });

    it('deletes a document for a session from the origin of the web UI', async () => {
      const id = await harness.addDocument(['synthetic page to delete']);
      const session = await signIn(harness.app);
      expect((await session.request(`/documents/${id}`, { method: 'DELETE' })).status).toBe(204);
    });

    it('judges a request with an Authorization header on it alone', async () => {
      const session = await signIn(harness.app);
      const wrongKey = await session.request(
        '/documents',
        harness.authorized({}, 'liasse_synthetic-unknown-key'),
      );
      expect(wrongKey.status).toBe(401);
    });

    it('refuses a forged cookie', async () => {
      const response = await harness.app.request('/documents', {
        headers: { Cookie: `${SECURE_SESSION_COOKIE}=synthetic-forged-session-token` },
      });
      expect(response.status).toBe(401);
    });
  });

  it('refuses a sign-out from another origin, then ends the session for good', async () => {
    const session = await signIn(harness.app);
    const foreign = await session.request(
      '/api/auth/sign-out',
      withHeaders(jsonRequest('POST', {}), { Origin: 'https://attacker.example.net' }),
      false,
    );
    expect(foreign.status).toBe(403);
    expect((await session.request('/documents')).status).toBe(200);
    const response = await session.request('/api/auth/sign-out', jsonRequest('POST', {}));
    expect(response.status).toBe(200);
    expect(setCookieLine(response, SECURE_SESSION_COOKIE)).toMatch(/Max-Age=0/);
    expect((await session.request('/documents')).status).toBe(401);
  });

  it('keeps a session across a restart of the server', async () => {
    const session = await signIn(harness.app);
    const restarted = harness.appWith({
      auth: createAuth({
        db: harness.database.db,
        secret: TEST_AUTH_SECRET,
        publicUrl: TEST_PUBLIC_URL,
        sessionTtlMs: 60_000,
        report: () => undefined,
      }),
    });
    const response = await restarted.request('/documents', {
      headers: { Cookie: session.cookie },
    });
    expect(response.status).toBe(200);
  });

  it('changes the password of the signed-in account', async () => {
    const session = await signIn(harness.app);
    const change = (current: string, next: string) =>
      session.request(
        '/api/auth/change-password',
        jsonRequest('POST', { currentPassword: current, newPassword: next }),
      );
    expect((await change('synthetic-wrong-password', 'synthetic-next-password')).status).toBe(400);
    expect((await change(TEST_ACCOUNT.password, 'short')).status).toBe(400);
    expect((await change(TEST_ACCOUNT.password, 'synthetic-next-password')).status).toBe(200);
    const old = await harness.app.request(
      '/api/auth/sign-in/email',
      signInRequest(TEST_ACCOUNT.email, TEST_ACCOUNT.password),
      newClient(),
    );
    expect(old.status).toBe(401);
    expect((await change('synthetic-next-password', TEST_ACCOUNT.password)).status).toBe(200);
  });

  it('stays out of the OpenAPI contract', async () => {
    const response = await harness.call('/openapi.json');
    const contract = z.object({ paths: z.record(z.string(), z.unknown()) });
    const paths = Object.keys(contract.parse(await response.json()).paths);
    expect(paths).toContain('/documents');
    expect(paths.filter((path) => /^\/($|ui|api\/auth|\.well-known)/.test(path))).toEqual([]);
  });
});
