import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpHarness, type HttpHarness } from '../harness.test-helper.ts';

const ENDPOINT = 'http://liasse.test/mcp';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'liasse-test', version: '0.0.0' },
  },
};

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

const textAnswer = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
});
const hits = z.object({ results: z.array(z.object({ id: z.string() })) });

describe('/mcp', () => {
  let harness: HttpHarness;
  let publicId: string;
  let privateId: string;
  const clients: Client[] = [];

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
    await Promise.all(clients.map(async (client) => client.close()));
    await harness.dispose();
  });

  // The SDK client over the real application, answered in process.
  const connect = async (token: string | undefined): Promise<Client> => {
    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
      fetch: async (url, init) => harness.app.request(String(url), init),
      ...(token === undefined
        ? {}
        : { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    });
    const client = new Client({ name: 'liasse-test', version: '0.0.0' });
    await client.connect(transport);
    clients.push(client);
    return client;
  };

  const post = (body: unknown, init: RequestInit = {}) =>
    harness.app.request('/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    });

  it('refuses a client without a valid token, pointing it at the resource metadata', async () => {
    await expect(connect(undefined)).rejects.toThrow();
    await expect(connect('synthetic-wrong-token')).rejects.toThrow();
    const response = await post(INITIALIZE);
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://liasse.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('serves the tools to a client with the token', async () => {
    const client = await connect(harness.token);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(20);
  });

  it('applies the private-document rules of REST to search', async () => {
    const client = await connect(harness.token);
    const idsOf = async (args: Readonly<Record<string, unknown>>) => {
      const result = CallToolResultSchema.parse(
        await client.callTool({ name: 'search', arguments: { ...args } }),
      );
      const [{ text }] = textAnswer.parse(result).content;
      return hits.parse(JSON.parse(text)).results.map(({ id }) => id);
    };
    const rest = async (body: unknown) => {
      const response = await harness.call('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return hits.parse(await response.json()).results.map(({ id }) => id);
    };
    expect(await idsOf({ query: 'zircon' })).toEqual([publicId]);
    expect(await idsOf({ query: 'zircon' })).toEqual(await rest({ query: 'zircon' }));
    expect((await idsOf({ query: 'zircon', include_private: true })).toSorted()).toEqual(
      [publicId, privateId].toSorted(),
    );
  });

  it.each(['GET', 'DELETE'])('answers %s with 405: the server keeps no session', async (method) => {
    const response = await harness.app.request('/mcp', harness.authorized({ method }));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(await response.json()).toMatchObject({ error: { code: 'method_not_allowed' } });
  });

  it('refuses a body that is not JSON, nested too deep, or of another type', async () => {
    const notJson = await post('{', harness.authorized({ headers: MCP_HEADERS }));
    expect(notJson.status).toBe(400);
    const deep = await post(
      `${'['.repeat(40)}${']'.repeat(40)}`,
      harness.authorized({ headers: MCP_HEADERS }),
    );
    expect(deep.status).toBe(400);
    expect(await deep.json()).toMatchObject({ error: { code: 'invalid_body' } });
    const text = await post(
      JSON.stringify(INITIALIZE),
      harness.authorized({ headers: { ...MCP_HEADERS, 'Content-Type': 'text/plain' } }),
    );
    expect(text.status).toBe(415);
  });

  it('refuses a body larger than a base64 file of the size limit', async () => {
    const tooLarge = JSON.stringify({ ...INITIALIZE, padding: 'x'.repeat(2 * 1024 * 1024) });
    const response = await post(tooLarge, harness.authorized({ headers: MCP_HEADERS }));
    expect(response.status).toBe(413);
  });
});
