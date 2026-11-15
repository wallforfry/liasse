import { CSRF_HEADER } from '@liasse/core/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorized,
  createHttpHarness,
  type HttpHarness,
  jsonRequest,
} from '../harness.test-helper.ts';
import { signIn, uiApp, withHeaders } from './ui.test-helper.ts';

describe('the REST API with the session cookie of the web UI', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('accepts the cookie alone on GET, the original file included', async () => {
    const id = await harness.addDocument(['synthetic page']);
    const session = await signIn(uiApp(harness));
    expect((await session.request('/documents', {}, false)).status).toBe(200);
    expect((await session.request(`/documents/${id}`, {}, false)).status).toBe(200);
    expect((await session.request('/types', { method: 'HEAD' }, false)).status).toBe(200);
  });

  it.each([
    ['POST', '/search', jsonRequest('POST', { query: 'synthetic' })],
    ['PATCH', '/documents/doc_00000000000000000000000000', jsonRequest('PATCH', { private: true })],
    ['DELETE', '/documents/doc_00000000000000000000000000', { method: 'DELETE' }],
  ])('refuses %s without the CSRF token of the session', async (_, path, init) => {
    const app = uiApp(harness);
    const session = await signIn(app);
    const other = await signIn(app);
    const missing = await session.request(path, init, false);
    expect(missing.status).toBe(403);
    const forged = await session.request(path, withHeaders(init, { [CSRF_HEADER]: 'forged' }));
    expect(forged.status).toBe(403);
    const crossed = await session.request(path, withHeaders(init, { [CSRF_HEADER]: other.csrf }));
    expect(crossed.status).toBe(403);
    const sent = await session.request(path, init);
    expect([401, 403]).not.toContain(sent.status);
  });

  it('deletes a document for a session that sends its token', async () => {
    const id = await harness.addDocument(['synthetic page to delete']);
    const session = await signIn(uiApp(harness));
    expect((await session.request(`/documents/${id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('judges a request with an Authorization header on its Bearer token alone', async () => {
    const app = uiApp(harness);
    const session = await signIn(app);
    const wrongBearer = await session.request(
      '/documents',
      authorized({}, 'synthetic-unknown-token'),
    );
    expect(wrongBearer.status).toBe(401);
    const bearer = await app.request('/search', authorized(jsonRequest('POST', { query: 'x' })));
    expect(bearer.status).toBe(200);
  });

  it('keeps MCP to Bearer tokens', async () => {
    const session = await signIn(uiApp(harness));
    const response = await session.request(
      '/mcp',
      withHeaders(jsonRequest('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }), {
        Accept: 'application/json, text/event-stream',
      }),
    );
    expect(response.status).toBe(401);
  });

  it('never accepts a cookie when UI_PASSWORD is unset', async () => {
    const session = await signIn(uiApp(harness));
    const response = await harness.app.request('/documents', {
      headers: { Cookie: session.cookie, [CSRF_HEADER]: session.csrf },
    });
    expect(response.status).toBe(401);
  });
});
