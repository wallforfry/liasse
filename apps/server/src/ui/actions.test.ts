import type { ApiFeatures } from '@liasse/core/api';
import type { JsonObject } from '@liasse/core/db';
import { documents, typeChanges } from '@liasse/core/db';
import { applyChange, listChanges } from '@liasse/core/consolidation';
import { createType } from '@liasse/core/registry';
import {
  buildSyntheticPng,
  createFakeEmbedder,
  syntheticEml,
  syntheticPdf,
} from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpHarness, type HttpHarness } from '../http/harness.test-helper.ts';
import { formRequest, signIn, type SignedIn, uiApp, type UiAppOptions } from './ui.test-helper.ts';

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

    it('lists pending changes and decides them through bound consolidation', async () => {
      const { db } = harness.database;
      const created = await createType(
        { slug: 'ui_payslip', description: 'Synthetic payslip', fields: {} },
        { db, embedder: createFakeEmbedder(), maxNewTypesPerDay: 100, schemaLanguage: 'en' },
      );
      if (!created.ok) throw new Error(created.error.message);
      const seed = async (typeId: string, rationale: string) => {
        const [row] = await db
          .insert(typeChanges)
          .values({ kind: 'stabilize', payload: { type_id: typeId }, rationale, auto: true })
          .returning({ id: typeChanges.id });
        return row?.id ?? '';
      };
      const applied = await seed(created.value.id, '<i>synthetic</i> overlap');
      const gone = await seed('typ_01JC0000000000000000000000', 'A type that is gone.');
      const rejected = await seed(created.value.id, 'Proposed twice.');
      const { app, session } = await signedIn({
        features: {
          listChanges: (options) => listChanges({ db }, options),
          applyChange: (id, decision) => applyChange({ db }, id, decision),
        },
      });

      const listed = await (await session.get('/ui/changes')).text();
      expect(listed).toContain('&lt;i&gt;synthetic&lt;/i&gt; overlap');
      expect(listed).toContain(`action="/ui/changes/${applied}"`);
      expect(listed).toContain(`&quot;type_id&quot;: &quot;${created.value.id}&quot;`);

      const apply = await session.post(`/ui/changes/${applied}`, {
        decision: 'apply',
        note: 'synthetic note',
      });
      expect(apply.status).toBe(303);
      expect(apply.headers.get('Location')).toBe('/ui/changes?decided=apply');
      const refused = await session.post(`/ui/changes/${gone}`, { decision: 'apply' });
      expect(refused.headers.get('Location')).toBe('/ui/changes?decided=refused');
      const reject = await session.post(`/ui/changes/${rejected}`, { decision: 'reject' });
      expect(reject.headers.get('Location')).toBe('/ui/changes?decided=reject');
      expect(await (await session.get('/ui/changes?decided=apply')).text()).toContain(
        'The change was applied.',
      );
      expect(await (await session.get('/ui/changes')).text()).toContain(
        'No change waits for approval.',
      );
      const decided = await db
        .select({ id: typeChanges.id, status: typeChanges.status, note: typeChanges.note })
        .from(typeChanges);
      expect(decided).toEqual(
        expect.arrayContaining([
          { id: applied, status: 'applied', note: 'synthetic note' },
          { id: rejected, status: 'rejected', note: null },
        ]),
      );
      expect((await session.post(`/ui/changes/${applied}`, { decision: 'apply' })).status).toBe(
        400,
      );
      expect((await session.post(`/ui/changes/${gone}`, { decision: 'maybe' })).status).toBe(400);
      // Without the CSRF token of the session, nothing is decided.
      const waiting = await seed(created.value.id, 'Still waiting.');
      const forged = await app.request(
        `/ui/changes/${waiting}`,
        formRequest({ csrf: 'forged', decision: 'apply' }, session.cookie),
      );
      expect(forged.status).toBe(403);
      const [untouched] = await db
        .select({ status: typeChanges.status, decidedAt: typeChanges.decidedAt })
        .from(typeChanges)
        .where(eq(typeChanges.id, waiting));
      expect(untouched).toEqual({ status: 'pending', decidedAt: null });
    });

    it('answers a page with a 404 for a change it does not know', async () => {
      const { db } = harness.database;
      const { session } = await signedIn({
        features: { applyChange: (id, decision) => applyChange({ db }, id, decision) },
      });
      const response = await session.post('/ui/changes/chg_01JC0000000000000000000000', {
        decision: 'apply',
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('Content-Type')).toMatch(/^text\/html/);
      expect(await response.text()).toContain('No change has this id.');
    });
  });
});
