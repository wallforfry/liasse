import { describe, expect, it } from 'vitest';
import { createLiasseClient } from './client.ts';
import { LiasseApiError, LiasseResponseError } from './errors.ts';

interface Sent {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

// A server that answers each request by its URL, and remembers what it got.
const answering = (respond: (url: string) => Response) => {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, init });
    return Promise.resolve(respond(url));
  };
  return { fetch, sent };
};

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const EMPTY_LIST = { documents: [], total: 0, has_more: false };
const NO_DATES = { dates: [], truncated: false };
const REJECTED_CHANGE = {
  id: 'chg_01',
  kind: 'merge',
  payload: { source_id: 'typ_a', target_id: 'typ_b', field_mapping: {}, confidence: 0.6 },
  rationale: 'Both are bills.',
  status: 'rejected',
  auto: false,
  created_at: '2026-11-14T03:00:00.000Z',
  decided_at: '2026-11-14T09:00:00.000Z',
  note: 'Not the same type.',
};

describe('createLiasseClient', () => {
  it('sends the token and resolves routes under the path prefix of the base URL', async () => {
    const server = answering((url) => json(url.includes('/upcoming') ? NO_DATES : EMPTY_LIST));
    const client = createLiasseClient({
      baseUrl: 'https://proxy.example.com/liasse',
      token: 'synthetic-token',
      fetch: server.fetch,
    });
    await client.upcoming({
      from: '2026-01-01',
      to: '2026-03-31',
      kinds: ['expiry', 'renewal'],
      current_only: false,
    });
    await client.listDocuments({ private: 'only', type: undefined, limit: 5 });
    expect(server.sent.map(({ url }) => url)).toEqual([
      'https://proxy.example.com/liasse/upcoming?from=2026-01-01&to=2026-03-31&kinds=expiry%2Crenewal&current_only=false',
      'https://proxy.example.com/liasse/documents?private=only&limit=5',
    ]);
    expect(new Headers(server.sent[0]?.init?.headers).get('Authorization')).toBe(
      'Bearer synthetic-token',
    );
  });

  it('sends a session through its cookie alone, without Authorization', async () => {
    const server = answering((url) =>
      url.endsWith('/documents/doc_01') ? new Response(null, { status: 204 }) : json(EMPTY_LIST),
    );
    const client = createLiasseClient({
      baseUrl: 'https://liasse.example.com',
      session: true,
      fetch: server.fetch,
    });
    await client.listDocuments();
    await client.deleteDocument('doc_01');
    const headers = server.sent.map(({ init }) => new Headers(init?.headers));
    expect(headers.map((sent) => sent.get('Authorization'))).toEqual([null, null]);
    expect(server.sent.map(({ init }) => init?.credentials)).toEqual([
      'same-origin',
      'same-origin',
    ]);
  });

  it('forwards the filters of every list and the decision on a change', async () => {
    const answers: Readonly<Record<string, unknown>> = {
      '/subjects': { subjects: [], truncated: false },
      '/entities': { entities: [], total: 0 },
      '/types': { types: [] },
      '/changes': { changes: [], truncated: false },
      '/changes/chg_01': { change: REJECTED_CHANGE, documents_to_reextract: 0 },
      '/consolidation/runs': { queued: false },
    };
    const server = answering((url) => json(answers[new URL(url).pathname] ?? {}));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    await client.listSubjects({ query: 'home', kind: 'contract' });
    await client.listEntities({ query: 'zirc', kind: 'org', limit: 5, include_private: true });
    await client.listTypes({ status: 'stable', include_examples: true, include_private: false });
    expect(await client.listChanges({ kind: 'merge' })).toEqual({ changes: [], truncated: false });
    expect(
      await client.decideChange('chg_01', { decision: 'reject', note: 'Not the same type.' }),
    ).toEqual({ change: REJECTED_CHANGE, documents_to_reextract: 0 });
    expect(await client.requestConsolidationRun()).toEqual({ queued: false });
    expect(server.sent.map(({ url }) => url)).toEqual([
      'http://x.test/subjects?query=home&kind=contract',
      'http://x.test/entities?query=zirc&kind=org&limit=5&include_private=true',
      'http://x.test/types?status=stable&include_examples=true&include_private=false',
      'http://x.test/changes?kind=merge',
      'http://x.test/changes/chg_01',
      'http://x.test/consolidation/runs',
    ]);
    expect(server.sent[5]?.init?.method).toBe('POST');
    const decision = server.sent[4]?.init;
    expect(decision?.method).toBe('POST');
    expect(new Headers(decision?.headers).get('Content-Type')).toBe('application/json');
    expect(decision?.body).toBe(JSON.stringify({ decision: 'reject', note: 'Not the same type.' }));
  });

  it('sends the file and the options of an upload in the fields of the contract', async () => {
    const server = answering(() => json({ id: 'doc_01', status: 'received', duplicate: false }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    await client.uploadDocument({ file: new Blob(['%PDF']), filename: 'a.pdf', private: false });
    const form = server.sent[0]?.init?.body;
    if (!(form instanceof FormData)) throw new Error('Expected a form');
    expect([...form.keys()]).toEqual(['file', 'private']);
    expect(form.get('private')).toBe('false');
    expect(server.sent[0]?.init?.method).toBe('POST');
  });

  it('turns the error body of the API into a LiasseApiError with its code', async () => {
    const server = answering(() =>
      json(
        {
          error: {
            code: 'invalid_request',
            message: 'The request is not valid.',
            request_id: 'req_01',
            issues: [{ path: 'limit', message: 'Too big' }],
          },
        },
        400,
      ),
    );
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    const error: unknown = await client.listDocuments({ limit: 5000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiasseApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: 'The request is not valid.',
      requestId: 'req_01',
      details: { issues: [{ path: 'limit', message: 'Too big' }] },
    });
  });

  it('rejects a failure without the error body of the API as a LiasseResponseError', async () => {
    const server = answering(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    const error: unknown = await client.listDocuments().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiasseResponseError);
    expect(error).toMatchObject({ status: 502 });
  });

  it('parses every answer and rejects one outside the contract', async () => {
    const server = answering(() => json({ documents: [{ id: 'doc_01' }], total: 1 }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    const error: unknown = await client.listDocuments().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiasseResponseError);
    expect(error).toMatchObject({ status: 200, cause: { name: 'ZodError' } });
  });

  it('reads the processing log of a document on its path, held to its schema', async () => {
    const event = {
      id: 'evt_01',
      occurred_at: '2026-11-14T03:00:00.000Z',
      stage: 'text',
      outcome: 'retrying',
      status: 'received',
      attempt: 1,
      max_attempts: 3,
      error_code: 'text_process_timeout',
      error_name: 'TextProcessError',
      http_status: null,
      provider_code: null,
      retryable: true,
      model: null,
      details: {},
    };
    const server = answering(() => json({ events: [event] }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    expect(await client.listDocumentEvents('doc/01')).toEqual({ events: [event] });
    expect(server.sent.map(({ url }) => url)).toEqual(['http://x.test/documents/doc%2F01/events']);
    const strange = answering(() => json({ events: [{ ...event, stage: 'guessing' }] }));
    const refused: unknown = await createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: strange.fetch,
    })
      .listDocumentEvents('doc_01')
      .catch((caught: unknown) => caught);
    expect(refused).toBeInstanceOf(LiasseResponseError);
  });

  it('holds the answers of subjects and key dates to their schemas', async () => {
    const server = answering(() => json({ dates: [] }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    await expect(client.upcoming({ from: '2027-01-01', to: '2027-12-31' })).rejects.toBeInstanceOf(
      LiasseResponseError,
    );
    await expect(client.listSubjects()).rejects.toBeInstanceOf(LiasseResponseError);
  });

  it('holds the answers of consolidation changes to their schemas', async () => {
    const server = answering(() => json({ changes: [{ id: 'chg_01' }] }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    await expect(client.listChanges()).rejects.toBeInstanceOf(LiasseResponseError);
    await expect(client.decideChange('chg_01', { decision: 'apply' })).rejects.toBeInstanceOf(
      LiasseResponseError,
    );
    await expect(client.requestConsolidationRun()).rejects.toBeInstanceOf(LiasseResponseError);
    await expect(client.listConsolidationRuns()).rejects.toBeInstanceOf(LiasseResponseError);
  });

  it('reads the latest consolidation runs', async () => {
    const run = {
      id: 'job_01',
      trigger: 'manual',
      status: 'failed',
      attempts: 3,
      queued_at: '2026-11-17T09:00:00.000Z',
      due_at: '2026-11-17T09:00:00.000Z',
      last_error: 'Error: the text model refused the request',
    };
    const server = answering(() => json({ runs: [run] }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    expect(await client.listConsolidationRuns()).toEqual({ runs: [run] });
    expect(server.sent.map(({ url, init }) => [url, init?.method ?? 'GET'])).toEqual([
      ['http://x.test/consolidation/runs', 'GET'],
    ]);
  });

  it('rejects a body that is not JSON as a LiasseResponseError', async () => {
    const server = answering(() => new Response('not json', { status: 200 }));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    await expect(client.listTypes()).rejects.toBeInstanceOf(LiasseResponseError);
  });

  it('answers the health of a server whose database is down rather than throwing', async () => {
    const server = answering(() => json({ status: 'unavailable' }, 503));
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch: server.fetch,
    });
    expect(await client.health()).toEqual({ status: 'unavailable' });
  });

  it('aborts a call that outlasts the timeout', async () => {
    // Answers only when the call is aborted, with the reason fetch would reject with.
    const fetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
        });
      });
    const client = createLiasseClient({
      baseUrl: 'http://x.test',
      token: 't',
      fetch,
      timeoutMs: 1,
    });
    await expect(client.listDocuments()).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
