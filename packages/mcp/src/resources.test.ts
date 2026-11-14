import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpHarness, type McpHarness } from './harness.test-helper.ts';

const contentsSchema = z.object({
  contents: z.tuple([z.object({ uri: z.string(), mimeType: z.string(), text: z.string() })]),
});

describe('the resources', () => {
  let harness: McpHarness;
  let client: Client;
  let privateId: string;

  beforeAll(async () => {
    harness = await createMcpHarness();
    client = await harness.connect();
    privateId = await harness.addDocument(['Synthetic zircon payslip, first page'], {
      title: 'Private payslip',
      private: true,
    });
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const read = async (uri: string) => {
    const [content] = contentsSchema.parse(await client.readResource({ uri })).contents;
    const body: unknown = JSON.parse(content.text);
    return { ...content, body };
  };

  const rejection = async (uri: string): Promise<McpError> => {
    const error: unknown = await client.readResource({ uri }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    if (!(error instanceof McpError)) throw new Error(`expected an McpError reading ${uri}`);
    return error;
  };

  it('lists types:// and the doc://{id} template, flagged as untrusted', async () => {
    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resources.map(({ uri }) => uri)).toEqual(['types://']);
    expect(resourceTemplates.map(({ uriTemplate }) => uriTemplate)).toEqual(['doc://{id}']);
    expect([...resources, ...resourceTemplates].map(({ description }) => description)).toEqual([
      expect.stringContaining('untrusted data'),
      expect.stringContaining('untrusted data'),
    ]);
  });

  it('reads the registry', async () => {
    expect(await read('types://')).toMatchObject({
      mimeType: 'application/json',
      body: { types: [] },
    });
  });

  it('reads a document with its text, private ones included', async () => {
    const { body } = await read(`doc://${privateId}`);
    expect(body).toMatchObject({
      id: privateId,
      private: true,
      text: { content: 'Synthetic zircon payslip, first page', has_more: false },
    });
  });

  it.each(['doc://doc_unknown', 'doc://a%00b', 'doc://..%2Fsecret'])(
    'answers resource-not-found with the body of a tool for %s',
    async (uri) => {
      const error = await rejection(uri);
      expect(error.code).toBe(-32002);
      expect(error.data).toEqual({
        error: { code: 'document_not_found', message: 'No document has this id.' },
      });
    },
  );
});
