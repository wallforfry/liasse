import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GOOGLE_CALLBACK_PATH } from '@liasse/contract';
import {
  type ApiContext,
  type ApiFeatures,
  createFileUrls,
  type SettingsContext,
  type SourcesContext,
} from '@liasse/core/api';
import { documentPages } from '@liasse/core/db';
import { indexDocument, rankByFullText } from '@liasse/core/search';
import type { Auth } from '@liasse/core/auth';
import { NO_TRUSTED_PROXIES } from '@liasse/core/network';
import { createSecretBox } from '@liasse/core/settings';
import { createSourceFiles, createSourceRuntime, storedGoogleClient } from '@liasse/core/sources';
import { createFsStorage } from '@liasse/core/storage';
import {
  createFakeEmbedder,
  createFakeModelFactories,
  createTestApiKey,
  createTestAuth,
  createTestDatabase,
  insertSyntheticDocument,
  type FakeGoogle,
  type NewDocumentRow,
  startFakeGoogle,
  SYNTHETIC_EMBEDDING_ENVIRONMENT,
  TEST_AUTH_SECRET,
  type TestDatabase,
} from '@liasse/core/testing';
import type { Hono } from 'hono';
import { createLogger } from '../log.ts';
import { type AppDependencies, createApp } from './app.ts';
import type { AppEnv } from './env.ts';
import { testAssets } from './ui/ui.test-helper.ts';

export const TEST_PUBLIC_URL = 'https://liasse.example.com';
export const TEST_MAX_FILE_SIZE = 64 * 1024;
const TEST_FILE_URL_SECRET = 'synthetic-file-url-secret-0123456789';

type AppOverrides = Partial<Omit<AppDependencies, 'api' | 'base'>> & {
  readonly features?: ApiFeatures;
  readonly queryTimeoutMs?: number;
};

export interface HttpHarness {
  readonly database: TestDatabase;
  /** The Google that the Drive sources of the app reach. */
  readonly google: FakeGoogle;
  readonly sources: SourcesContext;
  readonly api: ApiContext;
  /** The settings use cases of the app: fake models, and a preparation that changes nothing. */
  readonly settings: SettingsContext;
  readonly auth: Auth;
  readonly app: Hono<AppEnv>;
  /** An API key of the test account, and another one. */
  readonly token: string;
  readonly otherToken: string;
  /** The time signed URLs are issued and checked at; tests move it. */
  readonly clock: { now: number };
  /** Every line the application logged. */
  readonly logs: () => readonly string[];
  readonly appWith: (overrides: AppOverrides) => Hono<AppEnv>;
  /** `init` with the test API key, or `token`, as Bearer. */
  readonly authorized: (init?: RequestInit, token?: string) => RequestInit;
  /** A request carrying the test API key. */
  readonly call: (path: string, init?: RequestInit) => Promise<Response>;
  /** Inserts an indexed document with the given pages. */
  readonly addDocument: (
    pages: readonly string[],
    overrides?: Partial<NewDocumentRow>,
  ) => Promise<string>;
  readonly dispose: () => Promise<void>;
}

export const withBearer = (init: RequestInit, token: string): RequestInit => ({
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
  const auth = await createTestAuth(database.db, TEST_PUBLIC_URL);
  const token = await createTestApiKey(auth, 'test');
  const otherToken = await createTestApiKey(auth, 'other');
  const secrets = createSecretBox(TEST_AUTH_SECRET);
  const google = await startFakeGoogle();
  const { connectors, oauth } = createSourceRuntime({
    db: database.db,
    secrets,
    google: google.endpoints,
  });
  const sources: SourcesContext = {
    db: database.db,
    secrets,
    connectors,
    google: {
      oauth,
      client: storedGoogleClient(database.db, secrets),
      redirectUri: new URL(GOOGLE_CALLBACK_PATH, TEST_PUBLIC_URL).toString(),
    },
  };
  const api: ApiContext = {
    db: database.db,
    storage: createFsStorage(root),
    sourceFiles: createSourceFiles({ db: database.db, secrets, connectors }),
    embedder,
    fullText: rankByFullText,
    schemaLanguage: 'en',
    maxFileSize: TEST_MAX_FILE_SIZE,
    confidenceThreshold: 0.7,
    fileUrls: createFileUrls({
      secret: TEST_FILE_URL_SECRET,
      publicUrl: TEST_PUBLIC_URL,
      now: () => clock.now,
    }),
    features: {},
  };
  const settings: SettingsContext = {
    db: database.db,
    secrets,
    embedding: SYNTHETIC_EMBEDDING_ENVIRONMENT,
    factories: createFakeModelFactories(),
    prepare: () =>
      Promise.resolve({
        putInForce: () => undefined,
        settle: () => Promise.resolve(),
        discard: () => Promise.resolve(),
      }),
  };
  const appWith: HttpHarness['appWith'] = ({ features = {}, queryTimeoutMs, ...overrides }) => {
    const current: ApiContext = {
      ...api,
      features,
      ...(queryTimeoutMs === undefined ? {} : { queryTimeoutMs }),
    };
    return createApp({
      api: () => current,
      base: api,
      settings,
      sources,
      auth,
      setupToken: undefined,
      publicUrl: TEST_PUBLIC_URL,
      trustedProxies: NO_TRUSTED_PROXIES,
      assets: testAssets(),
      ping: database.ping,
      logger: createLogger((line) => lines.push(line)),
      ...overrides,
    });
  };
  const app = appWith({});
  const authorized = (init: RequestInit = {}, presented = token): RequestInit =>
    withBearer(init, presented);
  return {
    database,
    google,
    sources,
    api,
    settings,
    auth,
    app,
    token,
    otherToken,
    authorized,
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
      await google.close();
      await rm(root, { recursive: true, force: true });
      await database.dispose();
    },
  };
};
