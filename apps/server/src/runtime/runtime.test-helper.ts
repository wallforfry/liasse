import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, loadConfig } from '@liasse/core/config';
import { documents, jobs } from '@liasse/core/db';
import {
  buildSyntheticPdf,
  createApiKeyOverHttp,
  createFakeEmbedder,
  createFakeTextModel,
  createFakeVisionModel,
  createTestDatabase,
  SYNTHETIC_ENV,
  TEST_ACCOUNT,
  type TestDatabase,
} from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../log.ts';
import { answerFor } from '../synthetic-documents.fixture.ts';
import { type Bind, bindFeatures, type RuntimeParts } from './bindings.ts';
import { createRuntime, type Runtime, type RuntimeOptions } from './create-runtime.ts';

// The models are fakes: no test of the runtime calls a provider.
const withFakeModels = (parts: RuntimeParts): RuntimeParts => ({
  ...parts,
  embedder: createFakeEmbedder(),
  visionModel: createFakeVisionModel(),
  textModel: createFakeTextModel(({ system, prompt }) => answerFor(system, prompt)),
});

export const bindWithFakes: Bind = (parts) => bindFeatures(withFakeModels(parts));

export const withoutHandlers =
  (...kinds: readonly string[]): Bind =>
  (parts) => {
    const bindings = bindWithFakes(parts);
    return {
      ...bindings,
      handlers: bindings.handlers.filter(({ kind }) => !kinds.includes(kind)),
    };
  };

type Env = Readonly<Record<string, string>>;

export interface RuntimeHarness {
  readonly database: () => TestDatabase;
  readonly root: () => string;
  /** What the runtimes of the current test said on their logger. */
  readonly lines: () => readonly string[];
  readonly configOf: (env?: Env) => Config;
  /** Starts a runtime bound with fake models, stopped after the test. */
  readonly start: (env?: Env, options?: RuntimeOptions) => Promise<Runtime>;
  /** An API key of the test account on that runtime, made once per runtime. */
  readonly apiKey: (runtime: Runtime) => Promise<string>;
  readonly call: (runtime: Runtime, path: string, init?: RequestInit) => Promise<Response>;
  /** Uploads a PDF of these lines and returns the id of its document. */
  readonly upload: (runtime: Runtime, lines: readonly string[], name: string) => Promise<string>;
  readonly documentOf: (
    id: string,
  ) => Promise<{ readonly status: string; readonly private: boolean } | undefined>;
  /** The jobs of one kind queued for a document, whatever their status. */
  readonly jobsOf: (kind: string, id: string) => Promise<readonly { readonly status: string }[]>;
}

const idSchema = z.object({ id: z.string() });

/** A throwaway database and folder per test; call it inside a `describe`. */
export const useRuntimeHarness = (): RuntimeHarness => {
  let database: TestDatabase | undefined;
  let root: string | undefined;
  const lines: string[] = [];
  const started: Runtime[] = [];
  const keys = new Map<Runtime, Promise<string>>();

  beforeEach(async () => {
    database = await createTestDatabase({ migrate: false });
    root = await mkdtemp(join(tmpdir(), 'liasse-runtime-'));
    lines.length = 0;
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((runtime) => runtime.stop()));
    keys.clear();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    await database?.dispose();
  });

  const current = (): TestDatabase => {
    if (database === undefined) throw new Error('the harness runs inside a test only');
    return database;
  };
  const folder = (): string => {
    if (root === undefined) throw new Error('the harness runs inside a test only');
    return root;
  };

  // Port 0 lets the system pick a free one; the configuration itself refuses it.
  const configOf = (env: Env = {}): Config => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      DATABASE_URL: current().url,
      STORAGE_PATH: join(folder(), 'files'),
      EMBEDDING_CACHE_DIR: join(folder(), 'models'),
      AUTH_BOOTSTRAP_EMAIL: TEST_ACCOUNT.email,
      AUTH_BOOTSTRAP_PASSWORD: TEST_ACCOUNT.password,
      ...env,
    });
    return env.PORT === undefined ? { ...config, server: { ...config.server, port: 0 } } : config;
  };

  const baseUrlOf = (runtime: Runtime): string => `http://127.0.0.1:${String(runtime.port)}`;

  const apiKey = (runtime: Runtime): Promise<string> => {
    const known = keys.get(runtime);
    if (known !== undefined) return known;
    const created = createApiKeyOverHttp({
      baseUrl: baseUrlOf(runtime),
      publicUrl: configOf().server.publicUrl,
      account: TEST_ACCOUNT,
      name: 'runtime test',
    });
    keys.set(runtime, created);
    return created;
  };

  const call = async (runtime: Runtime, path: string, init: RequestInit = {}) =>
    fetch(`${baseUrlOf(runtime)}${path}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${await apiKey(runtime)}`,
      },
    });

  return {
    database: current,
    root: folder,
    lines: () => lines,
    configOf,
    start: async (env = {}, options = {}) => {
      const runtime = await createRuntime(configOf(env), {
        logger: createLogger((line) => lines.push(line)),
        bind: bindWithFakes,
        ...options,
      });
      started.push(runtime);
      return runtime;
    },
    apiKey,
    call,
    upload: async (runtime, pdfLines, name) => {
      const form = new FormData();
      form.append('file', new File([buildSyntheticPdf([{ lines: [...pdfLines] }])], name));
      const uploaded = await call(runtime, '/documents', { method: 'POST', body: form });
      return idSchema.parse(await uploaded.json()).id;
    },
    documentOf: async (id) =>
      (
        await current()
          .db.select({ status: documents.status, private: documents.private })
          .from(documents)
          .where(eq(documents.id, id))
      )[0],
    jobsOf: async (kind, id) =>
      (
        await current()
          .db.select({ kind: jobs.kind, payload: jobs.payload, status: jobs.status })
          .from(jobs)
      )
        .filter((job) => job.kind === kind && job.payload.documentId === id)
        .map(({ status }) => ({ status })),
  };
};
