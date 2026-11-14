import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, type HttpHarness } from '../http/harness.test-helper.ts';
import { UI_CONTENT_SECURITY_POLICY } from './markup.ts';
import { type SignedIn, signIn, uiApp } from './ui.test-helper.ts';

const SCRIPT_TITLE = '<script>alert("title")</script>';
const SCRIPT_SUMMARY = '<img src=x onerror=alert("summary")>';
const SCRIPT_TEXT = '</pre><script>alert("text")</script> synthetic hostile notice';

describe('web UI pages', () => {
  let harness: HttpHarness;
  let session: SignedIn;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    harness = await createHttpHarness();
    session = await signIn(uiApp(harness));
    ids.bill = await harness.addDocument(['Synthetic electricity bill for March, 42 EUR'], {
      title: 'Synthetic electricity bill',
      summary: 'A synthetic bill.',
      core: { amount: 42, vendor: 'Synthetic Power' },
    });
    ids.review = await harness.addDocument(['Synthetic insurance letter'], {
      title: 'Synthetic insurance letter',
      status: 'needs_review',
    });
    ids.secret = await harness.addDocument(['Synthetic electricity payslip, private'], {
      title: 'Synthetic private payslip',
      private: true,
    });
    ids.hostile = await harness.addDocument([SCRIPT_TEXT], {
      title: SCRIPT_TITLE,
      summary: SCRIPT_SUMMARY,
      core: { vendor: '<b onmouseover="alert(1)">bold</b>' },
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const pageOf = async (path: string): Promise<string> => {
    const response = await session.get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/html/);
    return response.text();
  };

  it('serves every page under a policy that runs no script', async () => {
    const response = await session.get('/ui/documents');
    expect(response.headers.get('Content-Security-Policy')).toBe(UI_CONTENT_SECURITY_POLICY);
    expect(UI_CONTENT_SECURITY_POLICY).not.toMatch(/script-src|unsafe/);
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    const stylesheet = await session.get('/ui/style.css');
    expect(stylesheet.headers.get('Content-Type')).toMatch(/^text\/css/);
  });

  it('lists documents, leaving private ones out unless asked', async () => {
    const listed = await pageOf('/ui/documents');
    expect(listed).toContain('Synthetic electricity bill');
    expect(listed).toContain('Synthetic insurance letter');
    expect(listed).not.toContain('Synthetic private payslip');
    expect(await pageOf('/ui/documents?private=include')).toContain('Synthetic private payslip');
    const reviewOnly = await pageOf('/ui/documents?status=needs_review&private=exclude');
    expect(reviewOnly).toContain('Synthetic insurance letter');
    expect(reviewOnly).not.toContain('Synthetic electricity bill');
  });

  it('lists the review queue', async () => {
    const queue = await pageOf('/ui/review');
    expect(queue).toContain('Synthetic insurance letter');
    expect(queue).not.toContain('Synthetic electricity bill');
    expect(queue).toContain('1 document<');
  });

  it('shows a document with its values and text, private ones included', async () => {
    const shown = await pageOf(`/ui/documents/${ids.bill ?? ''}`);
    expect(shown).toContain('A synthetic bill.');
    expect(shown).toContain('Synthetic Power');
    expect(shown).toContain('Synthetic electricity bill for March, 42 EUR');
    expect(shown).toContain(`/ui/documents/${ids.bill ?? ''}/file`);
    expect(await pageOf(`/ui/documents/${ids.secret ?? ''}`)).toContain(
      'Synthetic private payslip',
    );
    expect((await session.get('/ui/documents/doc_00000000000000000000000000')).status).toBe(404);
    expect((await session.get('/ui/documents/not-an-id!')).status).toBe(400);
  });

  it('searches, with private documents only when asked', async () => {
    const found = await pageOf('/ui/search?q=electricity');
    expect(found).toContain('Synthetic electricity bill');
    expect(found).toContain('<mark>');
    expect(found).not.toContain('Synthetic private payslip');
    expect(await pageOf('/ui/search?q=electricity&private=true')).toContain(
      'Synthetic private payslip',
    );
    expect(await pageOf('/ui/search')).not.toContain('<ol>');
  });

  it('renders the upload form', async () => {
    const form = await pageOf('/ui/upload');
    expect(form).toContain('enctype="multipart/form-data"');
    expect(form).toContain(session.csrf);
  });

  it('escapes document content on every page that shows it', async () => {
    const pages = await Promise.all([
      pageOf('/ui/documents'),
      pageOf(`/ui/documents/${ids.hostile ?? ''}`),
      pageOf('/ui/search?q=hostile'),
    ]);
    pages.forEach((markup) => {
      expect(markup).not.toContain('<script>alert');
      expect(markup).not.toContain('<img src=x');
      expect(markup).not.toContain('<b onmouseover');
    });
    const [list, document, search] = pages;
    expect(list).toContain('&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;');
    expect(document).toContain('&lt;img src=x onerror=alert(&quot;summary&quot;)&gt;');
    expect(document).toContain('&lt;/pre&gt;&lt;script&gt;alert(&quot;text&quot;)');
    expect(document).toContain('&lt;b onmouseover=');
    expect(search).toContain('&lt;script&gt;alert(&quot;title&quot;)');
  });

  it('sends the root of the server to the UI', async () => {
    const response = await uiApp(harness).request('/');
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/ui');
  });
});
