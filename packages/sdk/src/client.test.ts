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
