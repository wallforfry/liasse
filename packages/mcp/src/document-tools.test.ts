import { recordDocumentEvent } from '@liasse/core/processing-log';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callTool, createMcpHarness, type McpHarness } from './harness.test-helper.ts';

const failure = z.object({
  error: z.looseObject({ code: z.string(), message: z.string() }),
});
const page = z.object({
  documents: z.array(z.looseObject({ id: z.string() })),
  total: z.number(),
  has_more: z.boolean(),
});
const log = z.object({ events: z.array(z.looseObject({ attempt: z.number().nullable() })) });

describe('the tools that list, log and delete documents', () => {
  let harness: McpHarness;
  let client: Client;
  let publicId: string;
  let privateId: string;
  let flaggedId: string;

  beforeAll(async () => {
    harness = await createMcpHarness();
    client = await harness.connect();
    publicId = await harness.addDocument(['Synthetic quartz invoice'], { title: 'Invoice' });
    privateId = await harness.addDocument(['Synthetic quartz payslip'], {
      title: 'Payslip',
      private: true,
    });
    flaggedId = await harness.addDocument([], { status: 'needs_review', confidence: 0.4 });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const idsOf = async (args: Readonly<Record<string, unknown>>) => {
    const { isError, body } = await callTool(client, 'list_documents', args);
    expect(isError).toBe(false);
    return page.parse(body).documents.map(({ id }) => id);
  };

  const failureOf = async (name: string, args: Readonly<Record<string, unknown>>) => {
    const { isError, body } = await callTool(client, name, args);
    expect(isError).toBe(true);
    return failure.parse(body).error;
  };

  describe('list_documents', () => {
    it('leaves private documents out unless asked, most recent first', async () => {
      expect(await idsOf({})).toEqual([flaggedId, publicId]);
      expect(await idsOf({ private: 'only' })).toEqual([privateId]);
      expect((await idsOf({ private: 'include' })).toSorted()).toEqual(
        [flaggedId, privateId, publicId].toSorted(),
      );
    });

    it('gives the needs_review queue by its status, a page at a time', async () => {
      expect(await idsOf({ status: 'needs_review' })).toEqual([flaggedId]);
      const { body } = await callTool(client, 'list_documents', { limit: 1 });
      expect(page.parse(body)).toMatchObject({ total: 2, has_more: true });
    });

    it('refuses a status that is not one of a live document', async () => {
      const result = await client.callTool({
        name: 'list_documents',
        arguments: { status: 'deleted' },
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('list_document_events', () => {
    it('gives the whole processing log, where get_status gives its end', async () => {
      const failing = await harness.addDocument([], { status: 'failed', error: 'no_text' });
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        await harness.database.db.transaction((tx) =>
          recordDocumentEvent(tx, failing, { stage: 'text', outcome: 'retrying', attempt }),
        );
      }
      const { isError, body } = await callTool(client, 'list_document_events', { id: failing });
      expect(isError).toBe(false);
      expect(log.parse(body).events.map(({ attempt }) => attempt)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      ]);
      const status = log.parse((await callTool(client, 'get_status', { id: failing })).body);
      expect(status.events).toHaveLength(10);
    });

    it('answers document_not_found for an unknown id', async () => {
      expect((await failureOf('list_document_events', { id: 'doc_unknown' })).code).toBe(
        'document_not_found',
      );
    });
  });

  describe('delete_document', () => {
    it('deletes a document, which is then gone from every tool', async () => {
      const id = await harness.addDocument(['Synthetic quartz receipt'], { title: 'Receipt' });
      expect(await idsOf({})).toContain(id);
      const { isError, body } = await callTool(client, 'delete_document', { id });
      expect(isError).toBe(false);
      expect(body).toEqual({ id, deleted: true });
      expect(await idsOf({})).not.toContain(id);
      expect((await failureOf('get_document', { id })).code).toBe('document_not_found');
      expect((await failureOf('delete_document', { id })).code).toBe('document_not_found');
    });

    it('answers document_not_found for an unknown id', async () => {
      expect((await failureOf('delete_document', { id: 'doc_unknown' })).code).toBe(
        'document_not_found',
      );
    });
  });
});
