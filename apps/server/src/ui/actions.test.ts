import type { ApiFeatures, ChangeDecision } from '@liasse/core/api';
import type { JsonObject } from '@liasse/core/db';
import { documents } from '@liasse/core/db';
import { buildSyntheticPng, syntheticEml, syntheticPdf } from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, type HttpHarness } from '../http/harness.test-helper.ts';
import { signIn, type SignedIn, uiApp, type UiAppOptions } from './ui.test-helper.ts';

describe('web UI actions', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const signedIn = async (options: UiAppOptions = {}) => {
    const app = uiApp(harness, options);
    return { app, session: await signIn(app) };
  };

  const upload = async (
    { app, session }: { app: ReturnType<typeof uiApp>; session: SignedIn },
    bytes: Uint8Array,
    filename: string,
    fields: Readonly<Record<string, string>> = {},
  ) => {
    const body = new FormData();
    body.append('csrf', session.csrf);
    body.append('file', new File([bytes], filename));
    Object.entries(fields).forEach(([name, value]) => {
      body.append(name, value);
    });
    return app.request('/ui/upload', { method: 'POST', body, headers: { Cookie: session.cookie } });
  };

  describe('upload', () => {
    it('ingests the file and opens its document', async () => {
      const signed = await signedIn();
      const response = await upload(signed, syntheticPdf('ui upload'), 'ui-bill.pdf', {
        hint: 'a synthetic bill',
        private: 'true',
      });
      expect(response.status).toBe(303);
      const id = /^\/ui\/documents\/(\w+)$/.exec(response.headers.get('Location') ?? '')?.[1];
      expect(id).toBeDefined();
      const [row] = await harness.database.db
        .select()
        .from(documents)
        .where(eq(documents.id, id ?? ''));
      expect(row).toMatchObject({
        originalName: 'ui-bill.pdf',
        hint: 'a synthetic bill',
        private: true,
        source: 'api',
      });
      const shown = await signed.session.get(`/ui/documents/${id ?? ''}`);
      expect(await shown.text()).toContain('ui-bill.pdf');
      const file = await signed.session.get(`/ui/documents/${id ?? ''}/file`);
      expect(file.status).toBe(200);
      expect(file.headers.get('Content-Type')).toBe('application/pdf');
      expect(file.headers.get('Content-Security-Policy')).toBe('sandbox');
      expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(Buffer.from(await file.arrayBuffer()).equals(syntheticPdf('ui upload'))).toBe(true);
    });

    it('shows an image inline and offers any other file as a download', async () => {
      const signed = await signedIn();
      const image = await upload(signed, buildSyntheticPng(4, 4), 'scan.png');
      const imagePage = await signed.session.get(image.headers.get('Location') ?? '');
      expect(await imagePage.text()).toContain('<img class="preview"');
      const mail = await upload(signed, syntheticEml('ui mail'), 'letter.eml');
      const mailPath = mail.headers.get('Location') ?? '';
      expect(await (await signed.session.get(mailPath)).text()).not.toContain('<img');
      const file = await signed.session.get(`${mailPath}/file`);
      expect(file.headers.get('Content-Disposition')).toMatch(/^attachment;/);
      expect(file.headers.get('Content-Security-Policy')).toBe('sandbox');
    });

    it('says why a file is refused', async () => {
      const signed = await signedIn();
      const response = await upload(signed, new Uint8Array([0, 1, 2, 3]), 'noise.bin');
      expect(response.status).toBe(415);
      expect(await response.text()).toContain('enctype="multipart/form-data"');
      const empty = await signed.app.request('/ui/upload', {
        method: 'POST',
        body: new URLSearchParams({ csrf: signed.session.csrf }),
        headers: { Cookie: signed.session.cookie },
      });
      expect(empty.status).toBe(400);
    });

    it('needs a session before reading the form', async () => {
      const body = new FormData();
      body.append('file', new File([syntheticPdf('anonymous')], 'anonymous.pdf'));
      const response = await uiApp(harness).request('/ui/upload', { method: 'POST', body });
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe('/ui/login');
    });
  });

  describe('correction', () => {
    const corrections: JsonObject[] = [];
    const features: ApiFeatures = {
      correctDocument: (input) => {
        corrections.push(input);
        return Promise.resolve({ ok: true });
      },
    };

    it('sends only what the person changed', async () => {
      const { session } = await signedIn({ features });
      const id = await harness.addDocument([], {
        status: 'needs_review',
        title: 'Synthetic water bill',
        core: { amount: 12, vendor: 'Synthetic Water', iban: 'FR76 **** 0189' },
      });
      const response = await session.post(`/ui/documents/${id}`, {
        type: '',
        core: JSON.stringify({ amount: 21, vendor: 'Synthetic Water', iban: 'FR76 **** 0189' }),
        fields: '{}',
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe(`/ui/documents/${id}?corrected=1`);
      expect(corrections.at(-1)).toEqual({ id, core: { amount: 21 } });
      const after = await session.get(response.headers.get('Location') ?? '');
      expect(await after.text()).toContain('The correction was saved.');
    });

    it('turns the private flag on and off', async () => {
      const { session } = await signedIn({ features });
      const id = await harness.addDocument([], { core: {} });
      await session.post(`/ui/documents/${id}`, { private: 'true', core: '{}', fields: '{}' });
      expect(corrections.at(-1)).toEqual({ id, private: true });
    });

    it('refuses text that is not a JSON object, and a form that changes nothing', async () => {
      const { session } = await signedIn({ features });
      const id = await harness.addDocument([], { core: { amount: 1 } });
      const count = corrections.length;
      const broken = await session.post(`/ui/documents/${id}`, { core: '{"amount":' });
      expect(broken.status).toBe(400);
      expect(await broken.text()).toContain('Core values are not valid JSON.');
      const unchanged = await session.post(`/ui/documents/${id}`, {
        core: '{"amount": 1}',
        fields: '',
      });
      expect(unchanged.status).toBe(400);
      expect(await unchanged.text()).toContain('Nothing differs from the values shown.');
      expect(corrections).toHaveLength(count);
    });

    it('shows the reasons the pipeline gives for refusing a correction', async () => {
      const { session } = await signedIn({
        features: {
          correctDocument: () =>
            Promise.resolve({
              ok: false,
              errors: [{ code: 'invalid_value', message: 'amount <must> be a number' }],
            }),
        },
      });
      const id = await harness.addDocument([], { core: { amount: 1 } });
      const response = await session.post(`/ui/documents/${id}`, { core: '{"amount": "x"}' });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain('The correction was refused.');
      expect(body).toContain('amount &lt;must&gt; be a number');
    });

    it('says when this server cannot correct documents', async () => {
      const { session } = await signedIn();
      const id = await harness.addDocument([], { core: { amount: 1 } });
      const response = await session.post(`/ui/documents/${id}`, { core: '{"amount": 2}' });
      expect(response.status).toBe(501);
      expect(await response.text()).toContain('does not provide document correction yet');
    });
  });

  describe('changes', () => {
    it('gives the state the API gives while consolidation is not part of the build', async () => {
      const { session } = await signedIn();
      const response = await session.get('/ui/changes');
      expect(response.status).toBe(501);
      expect(await response.text()).toContain('does not provide consolidation changes yet');
      expect((await session.post('/ui/changes/chg_1', { decision: 'apply' })).status).toBe(501);
    });

    it('lists pending changes and records a decision', async () => {
      const decisions: [string, ChangeDecision][] = [];
      const { session } = await signedIn({
        features: {
          listChanges: () =>
            Promise.resolve({
              changes: [
                {
                  id: 'chg_1',
                  kind: 'merge',
                  rationale: '<i>synthetic</i> overlap',
                  payload: { from: 'bill', into: 'invoice' },
                },
              ],
            }),
          applyChange: (id, decision) => {
            decisions.push([id, decision]);
            return Promise.resolve({ id, status: 'applied' });
          },
        },
      });
      const listed = await (await session.get('/ui/changes')).text();
      expect(listed).toContain('&lt;i&gt;synthetic&lt;/i&gt; overlap');
      expect(listed).toContain('action="/ui/changes/chg_1"');
      expect(listed).toContain('&quot;into&quot;: &quot;invoice&quot;');
      const response = await session.post('/ui/changes/chg_1', {
        decision: 'apply',
        note: 'synthetic note',
      });
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe('/ui/changes?decided=apply');
      expect(decisions).toEqual([['chg_1', { decision: 'apply', note: 'synthetic note' }]]);
      expect(await (await session.get('/ui/changes?decided=apply')).text()).toContain(
        'The change was applied.',
      );
      expect((await session.post('/ui/changes/chg_1', { decision: 'maybe' })).status).toBe(400);
    });
  });
});
