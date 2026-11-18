import { documents, entities } from '@liasse/core/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness, jsonRequest } from '../harness.test-helper.ts';

const results = z.object({ results: z.array(z.looseObject({ id: z.string() })) });
const failed = z.object({ error: z.looseObject({ code: z.string() }) });

describe('search, query, registry and metrics routes', () => {
  let harness: HttpHarness;
  let publicId: string;
  let privateId: string;

  beforeAll(async () => {
    harness = await createHttpHarness();
    publicId = await harness.addDocument(['Synthetic zircon invoice of the workshop'], {
      title: 'Public invoice',
    });
    privateId = await harness.addDocument(['Synthetic zircon payslip of the workshop'], {
      title: 'Private payslip',
      private: true,
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const post = (path: string, body: unknown) => harness.call(path, jsonRequest('POST', body));
  const codeOf = async (response: Response) => failed.parse(await response.json()).error.code;

  describe('POST /search', () => {
    const idsOf = async (body: unknown): Promise<readonly string[]> => {
      const response = await post('/search', body);
      expect(response.status).toBe(200);
      return results.parse(await response.json()).results.map((hit) => hit.id);
    };

    it('returns private documents only when include_private is true', async () => {
      expect(await idsOf({ query: 'zircon' })).toEqual([publicId]);
      expect(await idsOf({ query: 'zircon', include_private: false })).toEqual([publicId]);
      expect((await idsOf({ query: 'zircon', include_private: true })).toSorted()).toEqual(
        [publicId, privateId].toSorted(),
      );
    });

    it.each([
      [{ query: 'zircon', include_private: 'true' }],
      [{ query: 'zircon', include_private: 1 }],
      [{ query: 'zircon', includePrivate: true }],
      [{ query: 'zircon', filters: { private: true } }],
      [{ query: 'zircon', limit: 500 }],
      [{}],
    ])('refuses %j', async (body) => {
      const response = await post('/search', body);
      expect(response.status).toBe(400);
      expect(await codeOf(response)).toBe('invalid_request');
    });

    it('refuses a character Postgres cannot hold with 400, not 500', async () => {
      const response = await post('/search', { query: 'zircon', filters: { type: 'a\u0000b' } });
      expect(response.status).toBe(400);
      expect((await harness.call('/documents?type=%00')).status).toBe(400);
    });
  });

  describe('POST /query', () => {
    it('answers with rows', async () => {
      const response = await post('/query', { select: ['private'], limit: 5 });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        rows: [{ id: publicId, private: false }],
        has_more: false,
        warnings: [],
      });
    });

    it('answers 400 with the errors of the DSL and their data fields', async () => {
      const response = await post('/query', { where: [['core.isuer', '=', 'x']] });
      expect(response.status).toBe(400);
      const body = z
        .object({
          error: z.object({
            code: z.string(),
            message: z.string(),
            request_id: z.string(),
            errors: z.array(z.looseObject({ code: z.string() })),
          }),
        })
        .parse(await response.json());
      expect(body.error.code).toBe('invalid_query');
      expect(body.error.errors.map((error) => error.code)).toEqual(['unknown_field']);
      expect(body.error.errors.find((error) => error.code === 'unknown_field')).toMatchObject({
        field: 'core.isuer',
        suggestion: 'core.issuer',
        path: ['where', 0, 0],
        truncated: false,
      });
    });

    it('answers 504 when the statement timeout stops the query', async () => {
      const app = harness.appWith({ queryTimeoutMs: 150 });
      const response = await harness.database.db.transaction(async (tx) => {
        await tx.execute(sql`LOCK TABLE documents IN ACCESS EXCLUSIVE MODE`);
        return app.request('/query', harness.authorized(jsonRequest('POST', {})));
      });
      expect(response.status).toBe(504);
      expect(await response.json()).toMatchObject({ error: { code: 'query_timeout' } });
    });

    it('refuses a NUL character in a value with 400 and its place, not a 503', async () => {
      const response = await post('/query', { where: [['title', '=', 'a\u0000b']] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'invalid_query',
          errors: [{ code: 'invalid_query', path: ['where', 0, 2] }],
        },
      });
    });

    it('binds what looks like a statement as a value', async () => {
      const before = await harness.database.db.$count(documents);
      const response = await post('/query', {
        where: [['core.reference', '=', "'; DELETE FROM documents; --"]],
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rows: [] });
      expect(await harness.database.db.$count(documents)).toBe(before);
    });
  });

  describe('GET /types and /entities', () => {
    it('describes the types', async () => {
      const response = await harness.call('/types?include_examples=true');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ types: [] });
      expect((await harness.call('/types?status=archived')).status).toBe(400);
      expect((await harness.call('/types?include_examples=yes')).status).toBe(400);
      expect((await harness.call('/types?include_private=true')).status).toBe(200);
      expect((await harness.call('/types?include_private=1')).status).toBe(400);
    });

    it('lists entities, counting private documents only when asked', async () => {
      await harness.database.db
        .insert(entities)
        .values({ kind: 'org', canonicalName: 'Atelier Zircon', aliases: ['Zircon Workshop'] });
      const response = await harness.call('/entities?query=zirc&kind=org&limit=5');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        entities: [
          {
            kind: 'org',
            canonical_name: 'Atelier Zircon',
            aliases: ['Zircon Workshop'],
            document_count: 0,
          },
        ],
        total: 1,
      });
      expect((await harness.call('/entities?kind=robot')).status).toBe(400);
      expect((await harness.call('/entities?limit=100000')).status).toBe(400);
      expect((await harness.call('/entities?include_private=true')).status).toBe(200);
    });

    it('reads an entity by its id, and answers 404 for an id no entity has', async () => {
      const [row] = await harness.database.db
        .insert(entities)
        .values({ kind: 'person', canonicalName: 'Synthetic Beryl' })
        .returning({ id: entities.id });
      const id = row?.id ?? '';
      const response = await harness.call(`/entities/${id}?include_private=true`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id,
        kind: 'person',
        canonical_name: 'Synthetic Beryl',
        aliases: [],
        identifiers: [],
        document_count: 0,
      });
      const missing = await harness.call('/entities/ent_01JC0000000000000000000000');
      expect(missing.status).toBe(404);
      expect(await codeOf(missing)).toBe('entity_not_found');
      expect((await harness.call(`/entities/${id}?include_private=1`)).status).toBe(400);
      expect((await harness.call(`/entities/${id}?kind=org`)).status).toBe(400);
      expect((await harness.call('/entities/not-an-id')).status).toBe(400);
    });
  });

  describe('POST /types', () => {
    const typeCounts = z.object({
      types: z.array(z.looseObject({ slug: z.string(), document_count: z.int() })),
    });
    const countOf = async (path: string): Promise<number | undefined> =>
      typeCounts
        .parse(await (await harness.call(path)).json())
        .types.find(({ slug }) => slug === 'workshop_invoice')?.document_count;

    it('creates a provisional type that GET /types then counts', async () => {
      const response = await post('/types', {
        slug: 'workshop_invoice',
        description: 'Invoice of a workshop',
        fields: { hours: { type: 'number' } },
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        slug: 'workshop_invoice',
        status: 'provisional',
        fields: { hours: { type: 'number' } },
        document_count: 0,
      });
      await harness.database.db.execute(
        sql`UPDATE documents SET type_id = (SELECT id FROM doc_types WHERE slug = 'workshop_invoice')
            WHERE id IN (${publicId}, ${privateId})`,
      );
      expect(await countOf('/types')).toBe(1);
      expect(await countOf('/types?include_private=true')).toBe(2);
    });

    it('answers the refusals of the registry with their codes', async () => {
      const invalid = await post('/types', { slug: 'Invoice October', description: 'Invoice' });
      expect(invalid.status).toBe(400);
      expect(await codeOf(invalid)).toBe('invalid_slug');
      const taken = await post('/types', { slug: 'workshop_invoice', description: 'Again' });
      expect(taken.status).toBe(400);
      expect(await codeOf(taken)).toBe('name_taken');
      const unknown = await post('/types', { slug: 'tool_invoice', description: 'X', id: 'x' });
      expect(await codeOf(unknown)).toBe('invalid_request');
    });

    it('needs credentials', async () => {
      const response = await harness.app.request(
        '/types',
        jsonRequest('POST', { slug: 'tool_invoice', description: 'Invoice of a tool' }),
      );
      expect(response.status).toBe(401);
    });
  });

  describe('routes whose module is not part of this build', () => {
    it.each([
      ['GET', '/subjects', undefined],
      ['GET', '/upcoming?from=2026-01-01&to=2026-03-31&kinds=expiry,renewal', undefined],
      ['GET', '/changes?kind=merge', undefined],
      ['POST', '/changes/chg_01JC0000000000000000000000', { decision: 'apply' }],
      ['POST', '/consolidation/runs', undefined],
      ['GET', '/consolidation/runs', undefined],
    ])('%s %s answers 501 with a typed error', async (method, path, body) => {
      const response = await harness.call(
        path,
        body === undefined ? { method } : jsonRequest(method, body),
      );
      expect(response.status).toBe(501);
      expect(await codeOf(response)).toBe('not_implemented');
    });

    it('validates their input all the same', async () => {
      const statuses = await Promise.all(
        [
          harness.call('/upcoming?from=2026-01-01'),
          harness.call('/upcoming?from=01/01/2026&to=2026-03-31'),
          harness.call('/upcoming?from=2026-01-01&to=2026-03-31&kinds=birthday'),
          harness.call('/subjects?kind=spaceship'),
          harness.call('/changes?kind=unknown'),
          post('/changes/chg_1', { decision: 'maybe' }),
        ].map(async (response) => (await response).status),
      );
      expect(statuses).toEqual([400, 400, 400, 400, 400, 400]);
    });

    it('hands the parsed input to a bound feature', async () => {
      const received: unknown[] = [];
      const app = harness.appWith({
        features: {
          upcoming: (options) => {
            received.push(options);
            return Promise.resolve({ dates: [] });
          },
          applyChange: (id, decision) => {
            received.push([id, decision]);
            return Promise.resolve(undefined);
          },
          requestConsolidationRun: () => {
            received.push('run');
            return Promise.resolve({ queued: true });
          },
          listConsolidationRuns: () => {
            received.push('runs');
            return Promise.resolve({ runs: [] });
          },
        },
      });
      const dates = await app.request(
        '/upcoming?from=2026-01-01&to=2026-03-31&kinds=expiry,renewal&current_only=false',
        harness.authorized(),
      );
      expect(await dates.json()).toEqual({ dates: [] });
      const change = await app.request(
        '/changes/chg_missing',
        harness.authorized(jsonRequest('POST', { decision: 'reject', note: 'not the same type' })),
      );
      expect(change.status).toBe(404);
      const run = await app.request('/consolidation/runs', harness.authorized({ method: 'POST' }));
      expect(run.status).toBe(202);
      expect(await run.json()).toEqual({ queued: true });
      const listed = await app.request('/consolidation/runs', harness.authorized());
      expect(listed.status).toBe(200);
      expect(await listed.json()).toEqual({ runs: [] });
      expect(received).toEqual([
        {
          from: '2026-01-01',
          to: '2026-03-31',
          kinds: ['expiry', 'renewal'],
          current_only: false,
          include_private: false,
        },
        ['chg_missing', { decision: 'reject', note: 'not the same type' }],
        'run',
        'runs',
      ]);
    });
  });

  describe('GET /metrics', () => {
    it('exposes counts in the Prometheus text format, with route templates as labels', async () => {
      await harness.call(`/documents/${publicId}?include=text`);
      await harness.call('/documents/doc_01JC0000000000000000000000');
      await harness.call(`/unknown-${publicId}`);
      const response = await harness.call('/metrics');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/plain; version=0.0.4; charset=utf-8');
      const text = await response.text();
      const lines = text.split('\n');
      expect(lines).toContain(
        'liasse_http_requests_total{method="GET",route="/documents/:id",status="200"} 1',
      );
      expect(lines).toContain(
        'liasse_http_requests_total{method="GET",route="/documents/:id",status="404"} 1',
      );
      expect(lines).toContain(
        'liasse_http_requests_total{method="GET",route="unmatched",status="404"} 1',
      );
      expect(lines).toContain('liasse_documents{status="indexed"} 2');
      expect(lines).toContain('liasse_documents{status="failed"} 0');
      expect(lines).toContain('liasse_job_queue_depth 0');
      expect(lines).toContain('# TYPE liasse_http_requests_total counter');
      expect(text).toMatch(/^process_resident_memory_bytes \d+$/m);
      expect(text).not.toContain('status="deleted"');
      expect(text).not.toContain(publicId);
      expect(text).not.toContain('Public invoice');
      expect(text).not.toContain('synthetic-token');
      // Every sample line is a name, optional labels and a number.
      const samples = lines.filter((line) => line !== '' && !line.startsWith('#'));
      expect(samples.filter((line) => !/^[a-z_]+(\{[^{}]*\})? [0-9.e+-]+$/.test(line))).toEqual([]);
    });
  });
});
