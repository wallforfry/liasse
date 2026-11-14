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
import type { Hono } from 'hono';
import { createLogger } from '../log.ts';
import { type AppDependencies, createApp } from './app.ts';
import type { AppEnv } from './env.ts';

export const TEST_TOKEN = 'synthetic-token-0001';
export const OTHER_TEST_TOKEN = 'synthetic-token-0002';
export const TEST_PUBLIC_URL = 'https://liasse.example.com';
export const TEST_MAX_FILE_SIZE = 64 * 1024;
const TEST_FILE_URL_SECRET = 'synthetic-file-url-secret-0123456789';

type AppOverrides = Partial<Omit<AppDependencies, 'api'>> & {
  readonly features?: ApiFeatures;
  readonly queryTimeoutMs?: number;
};

export interface HttpHarness {
  readonly database: TestDatabase;
  readonly api: ApiContext;
  readonly app: Hono<AppEnv>;
  /** The time signed URLs are issued and checked at; tests move it. */
  readonly clock: { now: number };
  /** Every line the application logged. */
  readonly logs: () => readonly string[];
  readonly appWith: (overrides: AppOverrides) => Hono<AppEnv>;
  /** A request carrying the test token. */
  readonly call: (path: string, init?: RequestInit) => Promise<Response>;
  /** Inserts an indexed document with the given pages. */
  readonly addDocument: (
    pages: readonly string[],
    overrides?: Partial<NewDocumentRow>,
  ) => Promise<string>;
  readonly dispose: () => Promise<void>;
}

export const authorized = (init: RequestInit = {}, token = TEST_TOKEN): RequestInit => ({
  ...init,
  headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${token}` },
});

export const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// The real application over a real database and the fs driver under a temporary root.
export const createHttpHarness = async (): Promise<HttpHarness> => {
  const database = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'liasse-http-'));
  const embedder = createFakeEmbedder();
  const clock = { now: 1_800_000_000_000 };
  const lines: string[] = [];
  const api: ApiContext = {
    db: database.db,
    storage: createFsStorage(root),
    embedder,
    fullText: rankByFullText,
    maxFileSize: TEST_MAX_FILE_SIZE,
    fileUrls: createFileUrls({
      secret: TEST_FILE_URL_SECRET,
      publicUrl: TEST_PUBLIC_URL,
      now: () => clock.now,
    }),
    features: {},
  };
  const appWith: HttpHarness['appWith'] = ({ features = {}, queryTimeoutMs, ...overrides }) =>
    createApp({
      api: { ...api, features, ...(queryTimeoutMs === undefined ? {} : { queryTimeoutMs }) },
      apiTokens: [TEST_TOKEN, OTHER_TEST_TOKEN],
      ping: database.ping,
      logger: createLogger((line) => lines.push(line)),
      ...overrides,
    });
  const app = appWith({});
  return {
    database,
    api,
    app,
    clock,
    logs: () => [...lines],
    appWith,
    call: async (path, init) => app.request(path, authorized(init)),
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
      await rm(root, { recursive: true, force: true });
      await database.dispose();
    },
  };
};
