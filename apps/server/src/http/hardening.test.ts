import { ApiError } from '@liasse/core/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MAX_JSON_BODY_BYTES, MAX_JSON_DEPTH, SECURITY_HEADERS } from './guards.ts';
import { createHttpHarness, type HttpHarness, jsonRequest } from './harness.test-helper.ts';

const errorOf = async (response: Response) =>
  z
    .object({ error: z.looseObject({ code: z.string(), message: z.string() }) })
    .parse(await response.json()).error;

const nested = (depth: number): string => `${'['.repeat(depth)}${']'.repeat(depth)}`;

describe('hardening', () => {
  let harness: HttpHarness;

  beforeAll(async () => {
    harness = await createHttpHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const failing = () =>
    harness.appWith({
      features: {
        listSubjects: () =>
          Promise.reject(
            new Error('select "secret_column" from "documents" where path = /data/files/ab/cd'),
          ),
      },
    });

  describe('every response', () => {
    it.each([
      ['a success', '/types', 200],
      ['a refusal', '/types?status=unknown', 400],
      ['an unknown route', '/nowhere', 404],
      ['a health check', '/health', 200],
    ])('carries the security headers and a request id: %s', async (_, path, status) => {
      const response = await harness.call(path);
      expect(response.status).toBe(status);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect([name, response.headers.get(name)]).toEqual([name, value]);
      }
      expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('carries them without a credential and after a failure', async () => {
      const responses = [
        await harness.app.request('/types'),
        await failing().request('/subjects', harness.authorized()),
      ];
      expect(responses.map((response) => response.status)).toEqual([401, 500]);
      for (const response of responses) {
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('X-Request-Id')).not.toBeNull();
      }
    });

    it('mints the request id itself, whatever the request claims', async () => {
      const claimed = 'forged-id\r\nX-Injected: 1';
      const response = await harness.call('/types', { headers: { 'X-Request-Id': 'forged-id' } });
      const other = await harness.call('/types');
      expect(response.headers.get('X-Request-Id')).not.toBe('forged-id');
      expect(response.headers.get('X-Request-Id')).not.toBe(other.headers.get('X-Request-Id'));
      expect(harness.logs().join('\n')).not.toContain(claimed.slice(0, 9));
    });

    it('allows no other origin: no CORS header, no preflight', async () => {
      const response = await harness.call('/types', {
        headers: { Origin: 'https://elsewhere.example' },
      });
      const preflight = await harness.app.request('/search', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://elsewhere.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      });
      const headers = [...response.headers.keys(), ...preflight.headers.keys()];
      expect(headers.filter((name) => name.startsWith('access-control-'))).toEqual([]);
      expect(preflight.status).toBe(404);
    });
  });

  describe('an unexpected failure', () => {
    it('answers 500 with the request id and nothing of what failed', async () => {
      const response = await failing().request('/subjects', harness.authorized());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: {
          code: 'internal_error',
          message: 'The server failed to answer this request.',
          request_id: response.headers.get('X-Request-Id'),
        },
      });
    });

    it('logs its class under the request id, without its message', async () => {
      const response = await failing().request('/subjects', harness.authorized());
      const requestId = response.headers.get('X-Request-Id') ?? 'none';
      const lines = harness.logs().filter((line) => line.includes(requestId));
      expect(
        lines.map((line) => z.object({ event: z.string() }).parse(JSON.parse(line)).event),
      ).toEqual(['request_failed', 'request']);
      expect(lines[0]).toContain('"error":"Error"');
      expect(lines.join('\n')).not.toContain('secret_column');
      expect(lines.join('\n')).not.toContain('/data/files');
    });
  });

  describe('a typed failure', () => {
    it('keeps its code and the request id whatever its details hold', async () => {
      const app = harness.appWith({
        features: {
          listSubjects: () =>
            Promise.reject(
              new ApiError('invalid_request', 'Refused.', {
                code: 'forged',
                request_id: 'forged',
                hint: 'kept',
              }),
            ),
        },
      });
      const response = await app.request('/subjects', harness.authorized());
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'invalid_request',
          message: 'Refused.',
          request_id: response.headers.get('X-Request-Id'),
          hint: 'kept',
        },
      });
    });
  });

  describe('a JSON body', () => {
    const search = (init: RequestInit) => harness.call('/search', { method: 'POST', ...init });

    it.each([
      ['no content type', undefined],
      ['text', 'text/plain'],
      ['a form', 'application/x-www-form-urlencoded'],
      ['something that only starts like JSON', 'application/jsonp'],
    ])('is refused with %s', async (_, contentType) => {
      const response = await search({
        headers: contentType === undefined ? {} : { 'Content-Type': contentType },
        body: '{"query":"invoice"}',
      });
      expect(response.status).toBe(415);
      expect((await errorOf(response)).code).toBe('unsupported_media_type');
    });

    it('is accepted with a charset parameter', async () => {
      const response = await search({
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{"query":"invoice"}',
      });
      expect(response.status).toBe(200);
    });

    it('is refused past the size limit, declared or not', async () => {
      const body = JSON.stringify({ query: 'x'.repeat(MAX_JSON_BODY_BYTES) });
      const declared = await search({ headers: { 'Content-Type': 'application/json' }, body });
      const chunked = await search({
        headers: { 'Content-Type': 'application/json' },
        body: new Blob([body]).stream(),
        duplex: 'half',
      });
      for (const response of [declared, chunked]) {
        expect(response.status).toBe(413);
        expect((await errorOf(response)).code).toBe('body_too_large');
      }
    });

    it('is refused when it is not JSON', async () => {
      for (const path of ['/search', '/query']) {
        const response = await harness.call(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"query": ',
        });
        expect([path, response.status]).toEqual([path, 400]);
        expect((await errorOf(response)).code).toBe('invalid_body');
      }
    });

    it('is refused when nested deeper than the limit, and read at the limit', async () => {
      const send = (depth: number) =>
        harness.call('/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: `{"where":${nested(depth - 1)}}`,
        });
      const tooDeep = await send(MAX_JSON_DEPTH + 1);
      expect(tooDeep.status).toBe(400);
      expect(await errorOf(tooDeep)).toMatchObject({
        code: 'invalid_body',
        message: 'The JSON body is nested deeper than 32.',
      });
      expect((await errorOf(await send(MAX_JSON_DEPTH))).code).toBe('invalid_query');
    });

    it('does not count brackets inside strings', async () => {
      const response = await search(jsonRequest('POST', { query: '[[['.repeat(40) + '\\"[[' }));
      expect(response.status).toBe(200);
    });

    it('names where a field is wrong, never its value', async () => {
      const response = await search(
        jsonRequest('POST', { query: 'invoice', limit: 'synthetic-secret-value', extra: true }),
      );
      expect(response.status).toBe(400);
      const text = await response.text();
      expect(text).toContain('"code":"invalid_request"');
      expect(text).toContain('"path":"limit"');
      expect(text).not.toContain('synthetic-secret-value');
    });
  });

  describe('a request that takes too long', () => {
    it('is answered 504', async () => {
      const app = harness.appWith({
        requestTimeoutMs: 20,
        features: { listSubjects: () => new Promise(() => undefined) },
      });
      const response = await app.request('/subjects', harness.authorized());
      expect(response.status).toBe(504);
      expect((await errorOf(response)).code).toBe('request_timeout');
    });
  });

  describe('the access log', () => {
    it('names the route template, never the path, the query or a header', async () => {
      const id = await harness.addDocument([]);
      const before = harness.logs().length;
      await harness.call(`/documents/${id}?include=fields`);
      await harness.app.request(`/documents/${id}/file?expires=1&signature=synthetic-signature`);
      await harness.call(`/secret-path-${harness.token}?q=1`);
      const lines = harness.logs().slice(before);
      expect(
        lines.map((line) =>
          z.looseObject({ route: z.string(), status: z.number() }).parse(JSON.parse(line)),
        ),
      ).toMatchObject([
        { event: 'request', method: 'GET', route: '/documents/:id', status: 200 },
        { event: 'request', method: 'GET', route: '/documents/:id/file', status: 401 },
        { event: 'request', method: 'GET', route: 'unmatched', status: 404 },
      ]);
      const written = lines.join('\n');
      for (const hidden of [id, 'synthetic-signature', 'include', harness.token, 'secret-path']) {
        expect(written).not.toContain(hidden);
      }
    });
  });
});
