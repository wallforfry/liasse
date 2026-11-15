import { documents, entities, jobs } from '@liasse/core/db';
import { syntheticPdf } from '@liasse/core/testing';
import { createLiasseClient, LiasseApiError, type LiasseClient } from '@liasse/sdk';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Listener, listen } from '../runtime/listen.ts';
import {
  createHttpHarness,
  type HttpHarness,
  TEST_MAX_FILE_SIZE,
  TEST_PUBLIC_URL,
} from './harness.test-helper.ts';

// The SDK against the real application, over a real socket and the global fetch.
describe('the TypeScript SDK', () => {
  let harness: HttpHarness;
  let listener: Listener;
  let client: LiasseClient;
  let baseUrl: string;
  let publicId: string;
  let privateId: string;

  beforeAll(async () => {
    harness = await createHttpHarness();
    listener = await listen({ fetch: harness.app.fetch, host: '127.0.0.1', port: 0 });
    baseUrl = `http://127.0.0.1:${String(listener.port)}`;
    client = createLiasseClient({ baseUrl, token: harness.token });
    publicId = await harness.addDocument(['Synthetic zircon invoice of the workshop'], {
      title: 'Public invoice',
    });
    privateId = await harness.addDocument(['Synthetic zircon payslip of the workshop'], {
      title: 'Private payslip',
      private: true,
    });
  });

  afterAll(async () => {
    await listener.close(0);
    await harness.dispose();
  });

  const refusal = async (call: Promise<unknown>): Promise<LiasseApiError> => {
    const error: unknown = await call.catch((caught: unknown) => caught);
    if (!(error instanceof LiasseApiError)) throw new Error('Expected a LiasseApiError');
    return error;
  };

  it('reads the health without a valid token, and refuses everything else', async () => {
    const stranger = createLiasseClient({ baseUrl, token: 'synthetic-wrong-token' });
    expect(await stranger.health()).toEqual({ status: 'ok' });
    const error = await refusal(stranger.listDocuments());
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(error.requestId).not.toBe('');
  });

  it('uploads a file as a multipart form, and recognises the same bytes', async () => {
    const bytes = syntheticPdf('sdk upload');
    const file = new File([bytes], 'sdk-invoice.pdf', { type: 'application/pdf' });
    const first = await client.uploadDocument({ file, hint: 'a synthetic bill', private: true });
    expect(first).toEqual({ id: first.id, status: 'received', duplicate: false });
    const again = await client.uploadDocument({ file: new Blob([bytes]), filename: 'copy.pdf' });
    expect(again).toEqual({ id: first.id, status: 'received', duplicate: true });

    const document = await client.getDocument(first.id);
    expect(document).toMatchObject({
      original_name: 'sdk-invoice.pdf',
      hint: 'a synthetic bill',
      private: true,
    });
    expect(await client.listDocumentEvents(first.id)).toEqual({ events: [] });
    const downloaded = await client.downloadFile(first.id);
    expect(downloaded).toMatchObject({ type: 'application/pdf', filename: 'sdk-invoice.pdf' });
    expect(new Uint8Array(await downloaded.content.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });

  it('carries the code and details of a refusal', async () => {
    const tooLarge = new Blob([new Uint8Array(TEST_MAX_FILE_SIZE + 1)]);
    expect(
      await refusal(client.uploadDocument({ file: tooLarge, filename: 'big.pdf' })),
    ).toMatchObject({
      status: 413,
      code: 'file_too_large',
      details: { max_file_size: TEST_MAX_FILE_SIZE },
    });
    expect(await refusal(client.getDocument('doc_unknown'))).toMatchObject({
      status: 404,
      code: 'document_not_found',
    });
    const invalid = await refusal(client.listDocuments({ limit: 0 }));
    expect(invalid).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(invalid.details).toHaveProperty('issues');
    expect(await refusal(client.listChanges())).toMatchObject({
      status: 501,
      code: 'not_implemented',
    });
  });

  it('leaves private documents out of a list unless they are asked for', async () => {
    const idsOf = async (privacy?: 'include' | 'only') =>
      (await client.listDocuments(privacy === undefined ? {} : { private: privacy })).documents.map(
        ({ id }) => id,
      );
    expect(await idsOf()).toContain(publicId);
    expect(await idsOf()).not.toContain(privateId);
    expect(await idsOf('only')).toContain(privateId);
    expect(await idsOf('only')).not.toContain(publicId);
    expect(await idsOf('include')).toEqual(expect.arrayContaining([publicId, privateId]));
    expect(await client.getDocument(privateId)).toMatchObject({ id: privateId, private: true });
  });

  it('reads the parts of a document asked for', async () => {
    const document = await client.getDocument(publicId, { include: ['text', 'file_url'] });
    expect(document.text?.content).toBe('Synthetic zircon invoice of the workshop');
    expect(document.file_url?.startsWith(`${TEST_PUBLIC_URL}/documents/${publicId}/file?`)).toBe(
      true,
    );
    expect(document.fields).toBeUndefined();
  });

  it('searches, with private documents only when asked', async () => {
    const idsOf = async (includePrivate: boolean) =>
      (await client.search({ query: 'zircon', include_private: includePrivate })).results.map(
        ({ id }) => id,
      );
    expect(await idsOf(false)).toEqual([publicId]);
    expect((await idsOf(true)).toSorted()).toEqual([publicId, privateId].toSorted());
  });

  it('runs a structured query and refuses a malformed one with its code', async () => {
    expect(
      await client.query({ select: ['private'], where: [['title', '=', 'Public invoice']] }),
    ).toMatchObject({
      rows: [{ id: publicId, title: 'Public invoice', private: false }],
      warnings: [],
    });
    expect(await refusal(client.query({ where: [['core.isuer', '=', 'x']] }))).toMatchObject({
      status: 400,
      code: 'invalid_query',
    });
  });

  it('describes the registry and lists entities', async () => {
    expect(await client.listTypes({ include_examples: true })).toEqual({ types: [] });
    await harness.database.db
      .insert(entities)
      .values({ kind: 'org', canonicalName: 'Atelier Zircon', aliases: [] });
    expect(await client.listEntities({ query: 'zirc', kind: 'org' })).toMatchObject({
      entities: [{ kind: 'org', canonical_name: 'Atelier Zircon', document_count: 0 }],
      total: 1,
    });
  });

  it('serves the metrics and the OpenAPI document', async () => {
    expect(await client.metrics()).toContain('liasse_');
    expect((await client.openApi()).openapi).toMatch(/^3\./);
  });

  it('retries a failed document, and refuses one that did not fail', async () => {
    const { id } = await client.uploadDocument({
      file: new File([syntheticPdf('sdk retry')], 'retry.pdf'),
    });
    expect(await refusal(client.retryDocument(id))).toMatchObject({
      status: 400,
      code: 'document_not_failed',
    });
    await harness.database.db
      .update(documents)
      .set({ status: 'failed', error: 'model_provider_failed' })
      .where(eq(documents.id, id));
    await harness.database.db
      .update(jobs)
      .set({ status: 'failed' })
      .where(eq(jobs.kind, 'process_document'));
    expect(await client.retryDocument(id)).toMatchObject({ id, status: 'received', error: null });
  });

  it('deletes a document, after which it is not found', async () => {
    const { id } = await client.uploadDocument({
      file: new File([syntheticPdf('sdk deletion')], 'gone.pdf'),
    });
    await client.deleteDocument(id);
    expect(await refusal(client.deleteDocument(id))).toMatchObject({
      status: 404,
      code: 'document_not_found',
    });
  });
});
