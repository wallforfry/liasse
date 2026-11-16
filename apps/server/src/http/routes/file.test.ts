import { documents } from '@liasse/core/db';
import { parseStorageKey } from '@liasse/core/storage';
import { syntheticEml, syntheticPdf, syntheticPng } from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness } from '../harness.test-helper.ts';
import { contentDisposition } from './file.ts';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

describe('GET /documents/:id/file', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const upload = async (bytes: Uint8Array<ArrayBuffer>, filename: string, isPrivate = false) => {
    const data = new FormData();
    data.append('file', new File([bytes], filename));
    data.append('private', String(isPrivate));
    const response = await harness.call('/documents', { method: 'POST', body: data });
    return z.object({ id: z.string() }).parse(await response.json()).id;
  };

  // The path and query of the signed URL of a document, as an authenticated caller gets it.
  const signedPath = async (id: string): Promise<string> => {
    const response = await harness.call(`/documents/${id}?include=file_url`);
    const { file_url: fileUrl } = z.object({ file_url: z.url() }).parse(await response.json());
    const url = new URL(fileUrl);
    return `${url.pathname}${url.search}`;
  };

  const withoutToken = (path: string, init?: RequestInit) => harness.app.request(path, init);

  describe('with a Bearer token', () => {
    it('streams the original bytes with headers that keep a browser from running them', async () => {
      const bytes = syntheticPdf('served');
      const id = await upload(bytes, 'relevé "été" 2026.pdf');
      const response = await harness.call(`/documents/${id}/file`);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
      expect(Object.fromEntries(response.headers)).toMatchObject({
        'content-type': 'application/pdf',
        'content-disposition':
          'inline; filename="relev____t___2026.pdf"; ' +
          "filename*=UTF-8''relev%C3%A9%20%22%C3%A9t%C3%A9%22%202026.pdf",
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cache-control': 'private, no-store',
        'x-frame-options': 'DENY',
      });
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('offers as a download what a browser could run', async () => {
      const id = await upload(syntheticEml('mail'), 'message.eml');
      const response = await harness.call(`/documents/${id}/file`);
      expect(response.headers.get('Content-Type')).toBe('message/rfc822');
      expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; /);
      expect(response.headers.get('Content-Security-Policy')).toBe('sandbox');
    });

    it('serves a type the row should not hold as bytes to download', async () => {
      const id = await upload(syntheticPng('mistyped'), 'page.png');
      await harness.database.db
        .update(documents)
        .set({ mime: 'text/html' })
        .where(eq(documents.id, id));
      const response = await harness.call(`/documents/${id}/file`);
      expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
      expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; /);
    });

    it('answers 404 for an unknown document, a deleted one and a lost file', async () => {
      const deleted = await upload(syntheticPdf('deleted'), 'deleted.pdf');
      await harness.call(`/documents/${deleted}`, { method: 'DELETE' });
      const lost = await upload(syntheticPdf('lost'), 'lost.pdf');
      const [row] = await harness.database.db
        .select({ storageKey: documents.storageKey })
        .from(documents)
        .where(eq(documents.id, lost));
      await harness.api.storage.delete(parseStorageKey(row?.storageKey ?? ''));
      const codes: string[] = [];
      for (const id of ['doc_01JC0000000000000000000000', deleted, lost]) {
        const response = await harness.call(`/documents/${id}/file`);
        expect(response.status).toBe(404);
        const body = z
          .object({ error: z.looseObject({ code: z.string() }) })
          .parse(await response.json());
        codes.push(body.error.code);
        expect(JSON.stringify(body)).not.toContain(row?.storageKey);
      }
      expect(codes).toEqual(['document_not_found', 'document_not_found', 'file_missing']);
    });
  });

  describe('content disposition', () => {
    it.each([
      ['a quote and a backslash', 'a"b\\c.pdf', 'a_b_c.pdf', 'a%22b%5Cc.pdf'],
      [
        'a line break',
        'a\r\nSet-Cookie: x=1.pdf',
        'a__Set-Cookie__x_1.pdf',
        'a%0D%0ASet-Cookie%3A%20x%3D1.pdf',
      ],
      [
        'a semicolon',
        'a; filename=evil.html',
        'a__filename_evil.html',
        'a%3B%20filename%3Devil.html',
      ],
      ['marks RFC 5987 reserves', "it's (1)*.pdf", 'it_s__1__.pdf', 'it%27s%20%281%29%2A.pdf'],
      ['no ASCII letter', '日本', '__', '%E6%97%A5%E6%9C%AC'],
    ])('cannot be broken out of by a name with %s', (_, name, ascii, encoded) => {
      expect(contentDisposition('application/zip', name)).toBe(
        `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      );
    });

    it('names an empty name', () => {
      expect(contentDisposition('image/png', '')).toBe(
        'inline; filename="file"; filename*=UTF-8\'\'',
      );
    });
  });

  describe('with a signed URL', () => {
    it('serves the file without a token until the URL expires, any number of times', async () => {
      const bytes = syntheticPdf('signed');
      const id = await upload(bytes, 'signed.pdf');
      const path = await signedPath(id);
      const start = harness.clock.now;
      for (const elapsed of [0, 1000, FIFTEEN_MINUTES_MS - 1000]) {
        harness.clock.now = start + elapsed;
        const response = await withoutToken(path);
        expect([elapsed, response.status]).toEqual([elapsed, 200]);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
      }
      harness.clock.now = start + FIFTEEN_MINUTES_MS;
      const expired = await withoutToken(path);
      expect(expired.status).toBe(401);
      expect(expired.headers.get('WWW-Authenticate')).toBe('Bearer realm="liasse"');
      harness.clock.now = start;
    });

    it('serves a private document: the URL was issued to a caller who could read it', async () => {
      const id = await upload(syntheticPdf('private signed'), 'private.pdf', true);
      expect((await withoutToken(await signedPath(id))).status).toBe(200);
    });

    it('opens the one document it was signed for, and only its file', async () => {
      const id = await upload(syntheticPdf('mine'), 'mine.pdf');
      const other = await upload(syntheticPdf('theirs'), 'theirs.pdf');
      const path = await signedPath(id);
      const query = path.slice(path.indexOf('?'));
      const statuses = await Promise.all(
        [
          `/documents/${other}/file${query}`,
          `/documents/${id}${query}`,
          `/documents${query}`,
          `/types${query}`,
          `/documents/${id}/file/${query}`,
        ].map(async (target) => (await withoutToken(target)).status),
      );
      expect(statuses).toEqual([401, 401, 401, 401, 404]);
      const deleting = await withoutToken(path, { method: 'DELETE' });
      expect(deleting.status).toBe(404);
      expect((await withoutToken(path)).status).toBe(200);
    });

    it.each([
      [
        'a later expiry',
        (query: URLSearchParams) => {
          query.set('expires', '99999999999');
        },
      ],
      [
        'no expiry',
        (query: URLSearchParams) => {
          query.delete('expires');
        },
      ],
      [
        'no signature',
        (query: URLSearchParams) => {
          query.delete('signature');
        },
      ],
      [
        'an empty signature',
        (query: URLSearchParams) => {
          query.set('signature', '');
        },
      ],
      [
        'a signature with one character changed',
        (query: URLSearchParams) => {
          const signature = query.get('signature') ?? '';
          query.set('signature', `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`);
        },
      ],
    ])('refuses %s', async (_, tamper) => {
      const id = await upload(syntheticPdf('tampered'), 'tampered.pdf');
      const url = new URL(await signedPath(id), 'http://localhost');
      tamper(url.searchParams);
      const response = await withoutToken(`${url.pathname}${url.search}`);
      expect(response.status).toBe(401);
    });

    it('trusts no other parameter', async () => {
      const id = await upload(syntheticPdf('extra parameter'), 'extra.pdf');
      const path = await signedPath(id);
      const signature = new URL(path, 'http://localhost').searchParams.get('signature') ?? '';
      for (const extra of ['download=1', `signature=${signature}`, 'expires=99999999999']) {
        expect([extra, (await withoutToken(`${path}&${extra}`)).status]).toEqual([extra, 400]);
      }
    });

    it('stops serving a document once it is deleted, and serves it again once revived', async () => {
      const bytes = syntheticPdf('deleted then revived');
      const id = await upload(bytes, 'revived.pdf');
      const path = await signedPath(id);
      await harness.call(`/documents/${id}`, { method: 'DELETE' });
      expect((await withoutToken(path)).status).toBe(404);
      expect(await upload(bytes, 'revived.pdf')).toBe(id);
      expect((await withoutToken(path)).status).toBe(200);
    });

    it('builds the URL from the configured origin, whatever the Host of the request', async () => {
      const id = await upload(syntheticPdf('host header'), 'host.pdf');
      const response = await harness.call(`/documents/${id}?include=file_url`, {
        headers: { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' },
      });
      const text = await response.text();
      expect(text).toContain('https://liasse.example.com/documents/');
      expect(text).not.toContain('attacker.example');
    });
  });
});
