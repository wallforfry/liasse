import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type ServerResponse } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documents, jobs } from '@liasse/core/db';
import {
  buildSyntheticPdf,
  createTestDatabase,
  SYNTHETIC_ENV,
  TEST_EMBEDDING_DIM,
  syntheticPdf,
  type TestDatabase,
  waitUntil,
} from '@liasse/core/testing';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { startModelStub } from './model-stub.test-helper.ts';
import { LETTER_LINES } from './synthetic-letter.fixture.ts';

const STEP_TIMEOUT_MS = 15_000;
const TOKEN = 'synthetic-token-0001';
const LISTENING = 'Liasse is listening on ';

const freePort = async (): Promise<number> => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return address.port;
};

const hasExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

interface RunningServer {
  readonly child: ChildProcess;
  readonly url: string;
  readonly database: TestDatabase;
  readonly stdout: () => string;
  readonly stderr: () => string;
  /** Sends SIGTERM and resolves to the exit code once the output streams have ended. */
  readonly terminate: () => Promise<number | null>;
}

interface Launched {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

// The real binary and the real entry point: a shim would not prove the signal wiring.
const launch = (env: Readonly<Record<string, string>>): Launched => {
  const child = spawn(
    process.execPath,
    [
      '--conditions=@liasse/source',
      '--experimental-strip-types',
      fileURLToPath(new URL('./main.ts', import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...SYNTHETIC_ENV, PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.push(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.push(chunk));
  return { child, stdout: () => stdout.join(''), stderr: () => stderr.join('') };
};

const withServer = async (
  env: Readonly<Record<string, string>>,
  use: (server: RunningServer) => Promise<void>,
): Promise<void> => {
  const database = await createTestDatabase({ migrate: false });
  const files = await mkdtemp(join(tmpdir(), 'liasse-process-'));
  const port = await freePort();
  const { child, stdout, stderr } = launch({
    STORAGE_PATH: files,
    EMBEDDING_CACHE_DIR: join(files, 'models'),
    ...env,
    DATABASE_URL: database.url,
    HOST: '127.0.0.1',
    PORT: String(port),
  });
  try {
    await waitUntil(() => {
      if (hasExited(child)) throw new Error(`the server exited before listening: ${stderr()}`);
      return stderr().includes(`${LISTENING}http://127.0.0.1:${String(port)}\n`);
    });
    await use({
      child,
      url: `http://127.0.0.1:${String(port)}`,
      database,
      stdout,
      stderr,
      terminate: async () => {
        // `close` comes after the output streams have ended, so both are complete.
        const closed = once(child, 'close', { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
        child.kill('SIGTERM');
        const [code] = z.tuple([z.number().nullable(), z.unknown()]).parse(await closed);
        return code;
      },
    });
  } finally {
    if (!hasExited(child)) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    await rm(files, { recursive: true, force: true });
    await database.dispose();
  }
};

const call = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
  });

const upload = async (url: string, label: string): Promise<string> => {
  const form = new FormData();
  form.append('file', new File([syntheticPdf(label)], `${label}.pdf`));
  const response = await call(`${url}/documents`, { method: 'POST', body: form });
  expect(response.status).toBe(201);
  return z.object({ id: z.string() }).parse(await response.json()).id;
};

/** Just enough of S3 for the driver, with object removals held until released. */
const startHoldingS3 = async () => {
  const held: ServerResponse[] = [];
  const server = createHttpServer((request, response) => {
    request.resume();
    const isObject = (request.url ?? '').split('/').length > 2;
    if (request.method === 'DELETE') held.push(response);
    else if (request.method === 'HEAD' && isObject) response.writeHead(404).end();
    else response.writeHead(200).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP port was assigned');
  return {
    endpoint: `http://127.0.0.1:${String(address.port)}`,
    holding: () => held.length,
    release: () => {
      held.splice(0).forEach((response) => response.writeHead(204).end());
    },
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
};

describe('server process', () => {
  it(
    'serves /health and a first PDF, exits with code 0 on SIGTERM, and writes nothing on stdout',
    async () => {
      await withServer({}, async ({ url, database, stdout, stderr, terminate }) => {
        const health = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        });
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: 'ok' });

        const id = await upload(url, 'first document');
        const stored = await call(`${url}/documents/${id}/file`);
        expect(Buffer.from(await stored.arrayBuffer())).toEqual(
          Buffer.from(syntheticPdf('first document')),
        );
        expect(await database.db.select({ id: documents.id }).from(documents)).toEqual([{ id }]);

        expect(await terminate()).toBe(0);
        // stdout belongs to MCP over stdio: the server itself never writes there.
        expect(stdout()).toBe('');
        expect(stderr()).toContain('"event":"request"');
        expect(stderr()).toContain('Notice: consolidation is not part of this build.');
        expect(stderr()).not.toContain(TOKEN);
      });
    },
    4 * STEP_TIMEOUT_MS,
  );

  it(
    'takes an uploaded document to indexed through the pipeline it binds',
    async () => {
      const models = await startModelStub(TEST_EMBEDDING_DIM);
      const env = {
        LLM_BASE_URL: models.url,
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'embedding-model',
        EMBEDDING_BASE_URL: models.url,
        EMBEDDING_DIM: String(TEST_EMBEDDING_DIM),
      };
      try {
        await withServer(env, async ({ url, database, terminate }) => {
          const form = new FormData();
          const pdf = buildSyntheticPdf([{ lines: ['processed in a process', ...LETTER_LINES] }]);
          form.append('file', new File([pdf], 'letter.pdf'));
          const response = await call(`${url}/documents`, { method: 'POST', body: form });
          expect(response.status).toBe(201);
          const { id } = z.object({ id: z.string() }).parse(await response.json());

          const statusOf = async () =>
            (
              await database.db
                .select({ status: documents.status })
                .from(documents)
                .where(eq(documents.id, id))
            )[0]?.status;
          await waitUntil(async () => (await statusOf()) === 'indexed');
          expect(models.paths).toContain('/v1/chat/completions');
          expect(models.paths).toContain('/v1/embeddings');
          expect(await terminate()).toBe(0);
        });
      } finally {
        await models.close();
      }
    },
    4 * STEP_TIMEOUT_MS,
  );

  it(
    'warns on stderr when a cloud model provider is configured',
    async () => {
      const apiKey = 'synthetic-llm-key-7c1e';
      await withServer({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: apiKey }, async (server) => {
        expect(await server.terminate()).toBe(0);
        expect(server.stderr()).toContain(
          'Warning: document content leaves this machine: ' +
            'document text and page images are sent to anthropic. ' +
            'Set LLM_PROVIDER=ollama and EMBEDDING_PROVIDER=local to keep it local.\n',
        );
        expect(server.stderr()).not.toContain(apiKey);
        expect(server.stdout()).toBe('');
      });
    },
    4 * STEP_TIMEOUT_MS,
  );

  it(
    'lets a job in flight finish before it exits',
    async () => {
      const s3 = await startHoldingS3();
      const env = {
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'synthetic-bucket',
        S3_ENDPOINT: s3.endpoint,
        S3_ACCESS_KEY_ID: 'synthetic-access-key',
        S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
      };
      try {
        await withServer(env, async ({ child, url, database, stdout, terminate }) => {
          const id = await upload(url, 'deleted during shutdown');
          expect((await call(`${url}/documents/${id}`, { method: 'DELETE' })).status).toBe(204);
          await waitUntil(() => s3.holding() === 1);

          const exit = terminate();
          // The listener is closed first: once it refuses connections the shutdown has
          // reached the workers, and the process must still be there for its job.
          await waitUntil(async () =>
            fetch(`${url}/health`, { signal: AbortSignal.timeout(STEP_TIMEOUT_MS) }).then(
              () => false,
              () => true,
            ),
          );
          expect(hasExited(child)).toBe(false);
          const running = await database.db.select({ status: jobs.status }).from(jobs);
          expect(running.map((job) => job.status)).toContain('running');

          s3.release();
          expect(await exit).toBe(0);
          expect(stdout()).toBe('');
          const settled = await database.db
            .select({ kind: jobs.kind, status: jobs.status })
            .from(jobs);
          expect(settled).toContainEqual({ kind: 'delete_file', status: 'succeeded' });
          const [tombstone] = await database.db
            .select({ fileDeletedAt: documents.fileDeletedAt })
            .from(documents);
          expect(tombstone?.fileDeletedAt).toBeInstanceOf(Date);
        });
      } finally {
        await s3.close();
      }
    },
    4 * STEP_TIMEOUT_MS,
  );

  it(
    'exits with code 1 and one sentence when it cannot start, without a secret in it',
    async () => {
      const password = 'synthetic-db-password-41c9';
      const { child, stdout, stderr } = launch({
        DATABASE_URL: `postgres://liasse:${password}@127.0.0.1:1/liasse`,
        PORT: String(await freePort()),
      });
      const closed: readonly unknown[] = await once(child, 'close', {
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      });
      expect(closed[0]).toBe(1);
      expect(stderr()).toMatch(
        /Liasse could not start: migrating the database failed \([A-Za-z]+ ECONNREFUSED\)\.\n$/,
      );
      expect(stderr()).not.toContain(password);
      expect(stderr()).not.toContain('    at ');
      expect(stdout()).toBe('');
    },
    4 * STEP_TIMEOUT_MS,
  );
});
