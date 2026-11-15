import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, type HttpHarness } from '../harness.test-helper.ts';
import { TEST_SCRIPT } from './ui.test-helper.ts';

const NONCE_META = /<meta property="csp-nonce" nonce="([A-Za-z0-9+/=]+)" \/>/;

const nonceOf = (html: string): string => NONCE_META.exec(html)?.[1] ?? '';

describe('the built web UI under /ui', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('serves index.html for the routes of the application, never from a cache', async () => {
    const { app } = harness;
    for (const path of ['/ui', '/ui/', '/ui/documents', '/ui/documents/doc_01/file-view']) {
      const response = await app.request(path);
      expect([path, response.status]).toEqual([path, 200]);
      expect(response.headers.get('Content-Type')).toBe('text/html; charset=UTF-8');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(await response.text()).toContain(`src="/ui/${TEST_SCRIPT}"`);
    }
  });

  it('writes a fresh nonce into the page and its policy, with no inline script allowed', async () => {
    const { app } = harness;
    const pages = await Promise.all([app.request('/ui/'), app.request('/ui/')]);
    const nonces = await Promise.all(
      pages.map(async (page) => {
        const nonce = nonceOf(await page.text());
        expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
        expect(page.headers.get('Content-Security-Policy')).toBe(
          "default-src 'none'; script-src 'self'; " +
            `style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; ` +
            "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        );
        return nonce;
      }),
    );
    expect(new Set(nonces).size).toBe(2);
    const policy = pages[0].headers.get('Content-Security-Policy') ?? '';
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('serves hashed files for a year and the others revalidated', async () => {
    const { app } = harness;
    const script = await app.request(`/ui/${TEST_SCRIPT}`);
    expect(script.status).toBe(200);
    expect(script.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(script.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await script.text()).toBe('export {};');
    const icon = await app.request('/ui/favicon.svg');
    expect(icon.headers.get('Cache-Control')).toBe('no-cache');
    expect(icon.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answers 404 for a missing file rather than the page', async () => {
    const response = await harness.app.request('/ui/assets/index-missing.js');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('sends the root of the server to the application', async () => {
    const response = await harness.app.request('/');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/ui/');
  });
});
