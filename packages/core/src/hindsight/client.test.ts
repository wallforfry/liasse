import { inspect } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { waitUntil } from '../testing/async.ts';
import { createHindsightClient, type HindsightClientOptions } from './client.ts';
import { HindsightError, HindsightUrlError } from './errors.ts';
import {
  type HindsightStub,
  startHindsightStub,
  type StubOptions,
  type StubReply,
} from './stub.test-helper.ts';
import type { RetainItem } from './wire.ts';

const SYNTHETIC_KEY = 'synthetic-hindsight-key-0001';
// Stands for the content of a fact: it must never reach an error.
const MARKER = 'synthetic-fact-marker';

const ITEM: RetainItem = {
  content: `[doc:doc_SYNTHETIC] A ${MARKER} fact. (valid_from 2025-03-01)`,
  document_id: 'doc_SYNTHETIC',
  context: 'Facts extracted from a document by Liasse',
  metadata: { source: 'liasse', document_id: 'doc_SYNTHETIC' },
};

const FAST: HindsightClientOptions = { retryDelayMs: 1 };

const failing = (status: number): StubReply => ({ status, body: { detail: 'synthetic failure' } });

const failureOf = async (promise: Promise<unknown>): Promise<HindsightError> => {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof HindsightError)) throw new Error('Expected a HindsightError');
  return error;
};

describe('createHindsightClient', () => {
  const stubs: HindsightStub[] = [];

  const start = async (options?: StubOptions): Promise<HindsightStub> => {
    const stub = await startHindsightStub(options);
    stubs.push(stub);
    return stub;
  };

  const clientOf = (stub: HindsightStub, options: HindsightClientOptions = FAST, apiKey?: string) =>
    createHindsightClient({ url: stub.url, bank: 'documents', apiKey }, options);

  afterEach(async () => {
    await Promise.all(stubs.splice(0).map((stub) => stub.close()));
  });

  it('retains one item in the bank, as JSON and without a key when none is set', async () => {
    const stub = await start();
    await clientOf(stub).retain(ITEM);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/default/banks/documents/memories',
      body: { items: [ITEM] },
    });
    expect(stub.calls[0]?.headers['content-type']).toBe('application/json');
    expect(stub.calls[0]?.headers.authorization).toBeUndefined();
    expect(stub.documents.get('documents/doc_SYNTHETIC')).toBe(ITEM.content);
  });

  it('sends the key as a Bearer token on a retain and on a forget', async () => {
    const stub = await start({ apiKey: SYNTHETIC_KEY });
    const client = clientOf(stub, FAST, SYNTHETIC_KEY);
    await client.retain(ITEM);
    await expect(client.forget(ITEM.document_id)).resolves.toBe(true);
    expect(stub.calls.map(({ headers }) => headers.authorization)).toEqual([
      `Bearer ${SYNTHETIC_KEY}`,
      `Bearer ${SYNTHETIC_KEY}`,
    ]);
    const refused = await failureOf(clientOf(stub).retain(ITEM));
    expect(refused).toMatchObject({ statusCode: 401, retryable: false });
  });

  it('keeps the path of the base URL and encodes the bank and the document id', async () => {
    const stub = await start();
    const client = createHindsightClient(
      { url: `${stub.url}/memory//`, bank: 'my bank/1', apiKey: undefined },
      FAST,
    );
    await failureOf(client.retain(ITEM));
    await failureOf(client.forget('doc/../1'));
    expect(stub.calls.map(({ path }) => path)).toEqual([
      '/memory/v1/default/banks/my%20bank%2F1/memories',
      '/memory/v1/default/banks/my%20bank%2F1/documents/doc%2F..%2F1',
    ]);
  });

  it('forgets a document, and tells when Hindsight did not hold it', async () => {
    const stub = await start();
    const client = clientOf(stub);
    await client.retain(ITEM);
    await expect(client.forget(ITEM.document_id)).resolves.toBe(true);
    expect(stub.documents.size).toBe(0);
    expect(stub.calls[1]).toMatchObject({
      method: 'DELETE',
      path: '/v1/default/banks/documents/documents/doc_SYNTHETIC',
      body: undefined,
    });
    await expect(client.forget(ITEM.document_id)).resolves.toBe(false);
  });

  it.each([
    ['of a path that is no route', { status: 404, body: { detail: 'Not Found' } }],
    ['that is not JSON', { status: 404, body: '<html>not found</html>' }],
    ['without a detail', { status: 404, body: {} }],
    ['of a proxy', { status: 404, body: { detail: 'no such upstream' } }],
    ['worded otherwise', { status: 404, body: { detail: 'document not found' } }],
  ])('does not take a 404 %s for a forgotten document', async (_, reply) => {
    const stub = await start({ override: () => reply });
    const error = await failureOf(clientOf(stub).forget(ITEM.document_id));
    expect(error).toMatchObject({ operation: 'forget', statusCode: 404, retryable: false });
    expect(stub.calls).toHaveLength(1);
  });

  it.each([400, 410, 500])(
    'does not take a %i that says "Document not found" for a forgotten document',
    async (status) => {
      const stub = await start({
        override: () => ({ status, body: { detail: 'Document not found' } }),
      });
      const error = await failureOf(clientOf(stub, { retries: 0 }).forget(ITEM.document_id));
      expect(error).toMatchObject({ operation: 'forget', statusCode: status });
    },
  );

  it.each([408, 429, 500, 503])('sends again after a %i, then succeeds', async (status) => {
    const stub = await start({ override: (_, index) => (index < 2 ? failing(status) : undefined) });
    await clientOf(stub).retain(ITEM);
    expect(stub.calls).toHaveLength(3);
    expect(stub.documents.size).toBe(1);
  });

  it('gives up after the bounded retries and says another try can succeed', async () => {
    const stub = await start({ override: () => failing(503) });
    const error = await failureOf(clientOf(stub).retain(ITEM));
    expect(error).toMatchObject({ operation: 'retain', statusCode: 503, retryable: true });
    expect(error.message).toBe('Hindsight retain failed (HTTP 503)');
    expect(stub.calls).toHaveLength(3);
    const single = await start({ override: () => failing(503) });
    await failureOf(clientOf(single, { retries: 0 }).forget(ITEM.document_id));
    expect(single.calls).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 409, 422])('does not send again after a %i', async (status) => {
    const stub = await start({ override: () => failing(status) });
    const error = await failureOf(clientOf(stub).retain(ITEM));
    expect(error).toMatchObject({ statusCode: status, retryable: false, code: undefined });
    expect(stub.calls).toHaveLength(1);
  });

  it('gives up an attempt that gets no answer, and tries again', async () => {
    const stub = await start({ override: () => 'hang' });
    const error = await failureOf(clientOf(stub, { timeoutMs: 50, retries: 1 }).retain(ITEM));
    expect(error).toMatchObject({ code: 'timeout', retryable: true, statusCode: undefined });
    expect(error.message).toBe('Hindsight retain failed (timeout)');
    expect(stub.calls).toHaveLength(2);
  });

  it('bounds an attempt as well when the caller gives a signal of its own', async () => {
    const stub = await start({ override: () => 'hang' });
    const { signal } = new AbortController();
    const client = clientOf(stub, { timeoutMs: 50, retries: 0 });
    expect(await failureOf(client.forget(ITEM.document_id, signal))).toMatchObject({
      code: 'timeout',
    });
  });

  it('reports a server that cannot be reached', async () => {
    const stub = await start();
    await stub.close();
    const error = await failureOf(clientOf(stub).forget(ITEM.document_id));
    expect(error).toMatchObject({ operation: 'forget', code: 'network', retryable: true });
  });

  it('stops at once when the caller aborts, during a request or between two tries', async () => {
    const hanging = await start({ override: () => 'hang' });
    const during = new AbortController();
    const pending = failureOf(clientOf(hanging).retain(ITEM, during.signal));
    await waitUntil(() => hanging.calls.length === 1);
    during.abort();
    expect(await pending).toMatchObject({ code: 'aborted' });
    expect(hanging.calls).toHaveLength(1);

    const failingStub = await start({ override: () => failing(503) });
    const between = new AbortController();
    const waiting = failureOf(
      clientOf(failingStub, { retryDelayMs: 3_600_000 }).retain(ITEM, between.signal),
    );
    await waitUntil(() => failingStub.calls.length === 1);
    between.abort();
    expect(await waiting).toMatchObject({ code: 'aborted' });
    expect(failingStub.calls).toHaveLength(1);
  });

  it.each([
    ['says it failed', { status: 200, body: { success: false, items_count: 1 } }],
    ['stored no item', { status: 200, body: { success: true, items_count: 0 } }],
    ['is not JSON', { status: 200, body: 'ok' }],
  ])('refuses a success that %s, without sending again', async (_, reply) => {
    const stub = await start({ override: () => reply });
    const error = await failureOf(clientOf(stub).retain(ITEM));
    expect(error).toMatchObject({ code: 'invalid_response', statusCode: 200, retryable: false });
    expect(stub.calls).toHaveLength(1);
  });

  it('refuses a forget whose success is not the expected body', async () => {
    const stub = await start({ override: () => ({ status: 200, body: { success: false } }) });
    const error = await failureOf(clientOf(stub).forget(ITEM.document_id));
    expect(error).toMatchObject({ operation: 'forget', code: 'invalid_response' });
  });

  it('does not follow a redirect to another host', async () => {
    const elsewhere = await start();
    const stub = await start({
      override: () => ({
        status: 307,
        headers: { location: `${elsewhere.url}/v1/default/banks/documents/memories` },
        body: {},
      }),
    });
    await failureOf(clientOf(stub, { retries: 0 }).retain(ITEM));
    expect(elsewhere.calls).toHaveLength(0);
  });

  it('keeps the facts, the key and the answer of the server out of its errors', async () => {
    const stub = await start({
      override: ({ body, headers }) => ({
        status: 422,
        body: { detail: [{ msg: 'invalid', input: body, sent: headers.authorization }] },
      }),
    });
    const client = clientOf(stub, FAST, SYNTHETIC_KEY);
    const closed = await start();
    await closed.close();
    const errors = [
      await failureOf(client.retain(ITEM)),
      await failureOf(client.forget(MARKER)),
      await failureOf(clientOf(closed, FAST, SYNTHETIC_KEY).retain(ITEM)),
    ];
    errors.forEach((error) => {
      const shown = `${inspect(error, { depth: 10 })} ${JSON.stringify(error)} ${String(error.stack)}`;
      expect(shown).not.toContain(MARKER);
      expect(shown).not.toContain(SYNTHETIC_KEY);
      expect(shown).not.toContain('127.0.0.1');
      expect(error.cause).toBeUndefined();
    });
  });

  it.each([
    'http://synthetic-user:synthetic-password@127.0.0.1:8888',
    'http://127.0.0.1:8888/?token=synthetic-password',
    'http://127.0.0.1:8888/#synthetic-password',
    'ftp://127.0.0.1/synthetic-password',
    'synthetic-password',
  ])('refuses the base URL %s without quoting it', (url) => {
    const create = () => createHindsightClient({ url, bank: 'documents', apiKey: undefined });
    expect(create).toThrow(HindsightUrlError);
    expect(create).not.toThrow(/synthetic-password/);
  });
});
