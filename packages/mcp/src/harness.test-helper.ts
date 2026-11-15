import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ApiContext, type ApiFeatures, createFileUrls } from '@liasse/core/api';
import { documentPages } from '@liasse/core/db';
import { indexDocument, rankByFullText } from '@liasse/core/search';
import { createFsStorage } from '@liasse/core/storage';
import {
  createFakeEmbedder,
  createTestDatabase,
  insertSyntheticDocument,
  type NewDocumentRow,
  type TestDatabase,
} from '@liasse/core/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { handleMcpRequest } from './http.ts';

export const TEST_MAX_FILE_SIZE = 64 * 1024;

export interface Reported {
  readonly operation: string;
  readonly error: unknown;
}

export interface McpHarness {
  readonly database: TestDatabase;
  readonly api: ApiContext;
  /** Every failure the server reported. */
  readonly reported: readonly Reported[];
  /** A client of the server over Streamable HTTP, answered in process by `handleMcpRequest`. */
  readonly connect: (features?: ApiFeatures) => Promise<Client>;
  /** Inserts an indexed document with the given pages. */
  readonly addDocument: (
    pages: readonly string[],
    overrides?: Partial<NewDocumentRow>,
  ) => Promise<string>;
  readonly dispose: () => Promise<void>;
}

const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

// The real server and its real transport over a real database and the fs driver.
export const createMcpHarness = async (): Promise<McpHarness> => {
  const database = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'liasse-mcp-'));
  const embedder = createFakeEmbedder();
  const reported: Reported[] = [];
  const clients: Client[] = [];
  const api: ApiContext = {
    db: database.db,
    storage: createFsStorage(root),
    embedder,
    fullText: rankByFullText,
    schemaLanguage: 'en',
    maxFileSize: TEST_MAX_FILE_SIZE,
    fileUrls: createFileUrls({
      secret: 'synthetic-file-url-secret-0123456789',
      publicUrl: 'https://liasse.example.com',
    }),
    features: {},
  };
  const report = (operation: string, error: unknown): void => {
    reported.push({ operation, error });
  };
  return {
    database,
    api,
    reported,
    connect: async (features = {}) => {
      const deps = { api: { ...api, features }, report };
      const transport = new StreamableHTTPClientTransport(new URL('http://liasse.test/mcp'), {
        fetch: async (url, init) => handleMcpRequest(deps, new Request(url, init), bodyOf(init)),
      });
      const client = new Client({ name: 'liasse-test', version: '0.0.0' });
      await client.connect(transport);
      clients.push(client);
      return client;
    },
    addDocument: async (pages, overrides = {}) => {
      const { id } = await insertSyntheticDocument(database.db, {
        status: 'indexed',
        ...overrides,
      });
      if (pages.length > 0) {
        await database.db
          .insert(documentPages)
          .values(pages.map((text, index) => ({ documentId: id, page: index + 1, text })));
        await indexDocument({ db: database.db, embedder }, id);
      }
      return id;
    },
    dispose: async () => {
      await Promise.all(clients.map(async (client) => client.close()));
      await rm(root, { recursive: true, force: true });
      await database.dispose();
    },
  };
};

const textResultSchema = z.object({
  content: z.tuple([z.object({ type: z.literal('text'), text: z.string() })]),
});

/** The JSON a tool answered with, and whether it is a failure. */
export const parseAnswer = (
  result: CallToolResult,
): { readonly isError: boolean; readonly body: unknown } => {
  const { content } = textResultSchema.parse(result);
  return { isError: result.isError === true, body: JSON.parse(content[0].text) };
};

/** Calls a tool and reads its JSON answer. */
export const callTool = async (
  client: Client,
  name: string,
  args: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly isError: boolean; readonly body: unknown }> =>
  parseAnswer(CallToolResultSchema.parse(await client.callTool({ name, arguments: { ...args } })));
