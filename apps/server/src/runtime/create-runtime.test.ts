import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, loadConfig } from '@liasse/core/config';
import { documents, jobs } from '@liasse/core/db';
import { StartupError } from '@liasse/core/domain';
import { defineJobKind, enqueue, handle } from '@liasse/core/jobs';
import {
  createGate,
  createTestDatabase,
  SYNTHETIC_ENV,
  syntheticPdf,
  type TestDatabase,
  waitUntil,
} from '@liasse/core/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../log.ts';
import { type Bind, bindFeatures } from './bindings.ts';
import { createRuntime, type Runtime, type RuntimeOptions } from './create-runtime.ts';

const TOKEN = 'synthetic-token-0001';

const slowJob = defineJobKind({
  name: 'synthetic_slow',
  schema: z.object({ label: z.string() }),
});

const fastJob = defineJobKind({
  name: 'synthetic_fast',
  schema: z.object({ label: z.string() }),
});

describe('createRuntime', () => {
  let database: TestDatabase;
  let root: string;
  let lines: string[];
  const started: Runtime[] = [];

  beforeEach(async () => {
    database = await createTestDatabase({ migrate: false });
    root = await mkdtemp(join(tmpdir(), 'liasse-runtime-'));
    lines = [];
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((runtime) => runtime.stop()));
    await rm(root, { recursive: true, force: true });
    await database.dispose();
  });

  // Port 0 lets the system pick a free one; the configuration itself refuses it.
  const configOf = (env: Readonly<Record<string, string>> = {}): Config => {
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      DATABASE_URL: database.url,
      STORAGE_PATH: join(root, 'files'),
      EMBEDDING_CACHE_DIR: join(root, 'models'),
      ...env,
    });
    return env.PORT === undefined ? { ...config, server: { ...config.server, port: 0 } } : config;
  };

  const start = async (
    env: Readonly<Record<string, string>> = {},
    options: RuntimeOptions = {},
  ): Promise<Runtime> => {
    const runtime = await createRuntime(configOf(env), {
      logger: createLogger((line) => lines.push(line)),
      ...options,
    });
    started.push(runtime);
    return runtime;
  };

  const call = (runtime: Runtime, path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${String(runtime.port)}${path}`, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${TOKEN}`,
      },
    });

  const failureOf = async (work: Promise<unknown>): Promise<unknown> =>
    work.then(
      () => {
        throw new Error('expected the runtime not to start');
      },
      (error: unknown) => error,
    );

  it('migrates, listens on the loopback address and says what it does on the logger', async () => {
    const runtime = await start();
    // Read back from the socket: a listener on every interface would report 0.0.0.0 or ::.
    expect(runtime.address).toBe('127.0.0.1');
    expect((await call(runtime, '/types')).status).toBe(200);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Optional parts: watched folder off, Hindsight off, web UI off.',
        `Liasse is listening on http://127.0.0.1:${String(runtime.port)}`,
      ]),
    );
    expect(lines.some((line) => line.startsWith('Notice: document processing is not part'))).toBe(
      true,
    );
  });

  it('queues again at startup the file removals a past run gave up on', async () => {
    const first = await start();
    const form = new FormData();
    form.append('file', new File([syntheticPdf('owed removal')], 'owed.pdf'));
    const uploaded = await call(first, '/documents', { method: 'POST', body: form });
    const { id } = z.object({ id: z.string() }).parse(await uploaded.json());
    await first.stop();
    // A tombstone whose removal is owed and whose job is gone, as after a long outage.
    await database.db.update(documents).set({ status: 'deleted', fileDeletedAt: null });
    await database.db.delete(jobs);

    await start();
    const removals = () => database.db.select({ kind: jobs.kind, status: jobs.status }).from(jobs);
    await waitUntil(async () => (await removals()).some(({ status }) => status === 'succeeded'));
    expect(await removals()).toEqual([{ kind: 'delete_file', status: 'succeeded' }]);
    const [tombstone] = await database.db
      .select({ id: documents.id, fileDeletedAt: documents.fileDeletedAt })
      .from(documents);
    expect(tombstone?.id).toBe(id);
    expect(tombstone?.fileDeletedAt).toBeInstanceOf(Date);
  });

  it('ingests the files of the watched folder when WATCH_DIR is set', async () => {
    const inbox = join(root, 'inbox');
    await mkdir(inbox);
    await writeFile(join(inbox, 'dropped.pdf'), syntheticPdf('dropped'));
    await start({ WATCH_DIR: inbox });
    expect(lines).toContain('Optional parts: watched folder on, Hindsight off, web UI off.');
    await waitUntil(async () => (await database.db.$count(documents)) === 1);
    const [row] = await database.db.select().from(documents);
    expect(row).toMatchObject({ source: 'watch', originalName: 'dropped.pdf' });
  });

  it('binds Hindsight once HINDSIGHT_URL is set: a deletion forgets what the bank holds', async () => {
    const calls: string[] = [];
    const hindsight = createHttpServer((request, response) => {
      calls.push(`${request.method ?? ''} ${request.url ?? ''}`);
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ success: true, message: '', document_id: '', memory_units_deleted: 1 }),
      );
    });
    hindsight.listen(0, '127.0.0.1');
    await once(hindsight, 'listening');
    const address = hindsight.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      const runtime = await start({ HINDSIGHT_URL: `http://127.0.0.1:${String(address.port)}` });
      expect(lines.some((line) => line.includes('are sent to Hindsight at 127.0.0.1'))).toBe(true);
      const form = new FormData();
      form.append('file', new File([syntheticPdf('sent to the bank')], 'sent.pdf'));
      const uploaded = await call(runtime, '/documents', { method: 'POST', body: form });
      const { id } = z.object({ id: z.string() }).parse(await uploaded.json());
      // As if its facts had been retained: the bank may hold them.
      await database.db.update(documents).set({ hindsightHeldSince: new Date() });

      expect((await call(runtime, `/documents/${id}`, { method: 'DELETE' })).status).toBe(204);
      await waitUntil(() => calls.length === 1);
      expect(calls).toEqual([`DELETE /v1/default/banks/documents/documents/${id}`]);
      await waitUntil(async () => {
        const [row] = await database.db
          .select({ heldSince: documents.hindsightHeldSince })
          .from(documents);
        return row?.heldSince === null;
      });
    } finally {
      hindsight.close();
      await once(hindsight, 'close');
    }
  });

  it('queues no Hindsight sync without HINDSIGHT_URL', async () => {
    const runtime = await start();
    const form = new FormData();
    form.append('file', new File([syntheticPdf('kept local')], 'local.pdf'));
    const uploaded = await call(runtime, '/documents', { method: 'POST', body: form });
    const { id } = z.object({ id: z.string() }).parse(await uploaded.json());
    await database.db.update(documents).set({ hindsightHeldSince: new Date() });
    expect((await call(runtime, `/documents/${id}`, { method: 'DELETE' })).status).toBe(204);
    const kinds = await database.db.select({ kind: jobs.kind }).from(jobs);
    expect(kinds.map(({ kind }) => kind)).not.toContain('hindsight_sync');
  });

  it('binds handlers, their concurrency, features and notices through one seam', async () => {
    const gate = createGate();
    const running: string[] = [];
    let peak = 0;
    const bind: Bind = (parts) => {
      const defaults = bindFeatures(parts);
      return {
        ...defaults,
        handlers: [
          ...defaults.handlers,
          handle(slowJob, async ({ payload }) => {
            running.push(payload.label);
            peak = Math.max(peak, running.length);
            await gate.opened;
            running.splice(running.indexOf(payload.label), 1);
          }),
          handle(fastJob, () => Promise.resolve()),
        ],
        perKindConcurrency: { [slowJob.name]: 1 },
        features: { listSubjects: () => Promise.resolve({ subjects: [] }) },
        notices: ['Notice: synthetic binding.'],
      };
    };
    const runtime = await start({ WORKERS: '4' }, { bind });
    expect(lines).toContain('Notice: synthetic binding.');
    expect(await (await call(runtime, '/subjects')).json()).toEqual({ subjects: [] });
    expect((await call(runtime, '/upcoming?from=2026-01-01&to=2026-02-01')).status).toBe(501);

    for (const label of ['a', 'b', 'c']) {
      await enqueue(database.db, { kind: slowJob, payload: { label } });
    }
    await waitUntil(() => running.length === 1);
    // A job queued after the slow ones finishes while they wait: the dispatcher has had
    // free slots and passed over them, which only their cap explains.
    const fast = await enqueue(database.db, { kind: fastJob, payload: { label: 'fast' } });
    const statusOf = async (id: string) =>
      (await database.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, id)))[0]
        ?.status;
    await waitUntil(async () => (await statusOf(fast)) === 'succeeded');
    expect(running).toHaveLength(1);
    gate.open();
    await waitUntil(async () => {
      const rows = await database.db.select({ status: jobs.status }).from(jobs);
      return rows.every(({ status }) => status === 'succeeded');
    });
    expect(peak).toBe(1);
  });

  it('gives a job in flight until the deadline, then returns it to the queue', async () => {
    const gate = createGate();
    let aborted = false;
    const bind: Bind = (parts) => ({
      ...bindFeatures(parts),
      handlers: [
        handle(
          slowJob,
          ({ signal }) =>
            new Promise<void>((_, reject) => {
              gate.open();
              signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('interrupted'));
              });
            }),
        ),
      ],
    });
    const runtime = await start({}, { bind, shutdownGraceMs: 50 });
    await enqueue(database.db, { kind: slowJob, payload: { label: 'never ends' } });
    await gate.opened;
    expect(await runtime.stop()).toBe(true);
    expect(aborted).toBe(true);
    expect(lines).toContain('{"event":"jobs_interrupted","aborted":1,"abandoned":0}');
  });

  it('stops once, and refuses connections afterwards', async () => {
    const runtime = await start();
    const [first, second] = await Promise.all([runtime.stop(), runtime.stop()]);
    expect([first, second]).toEqual([true, true]);
    await expect(call(runtime, '/health')).rejects.toThrow();
  });

  it('explains a storage it cannot write to, and leaves nothing running', async () => {
    await writeFile(join(root, 'not-a-directory'), 'x');
    const error = await failureOf(start({ STORAGE_PATH: join(root, 'not-a-directory', 'files') }));
    expect(error).toBeInstanceOf(StartupError);
    expect(lines.some((line) => line.startsWith('Liasse is listening'))).toBe(false);
  });

  it('explains a port that is taken, and closes what it had opened', async () => {
    const taken = createServer();
    taken.listen(0, '127.0.0.1');
    await once(taken, 'listening');
    const address = taken.address();
    const port = address !== null && typeof address !== 'string' ? address.port : 0;
    try {
      const error = await failureOf(start({ PORT: String(port) }));
      expect(error).toBeInstanceOf(StartupError);
      expect(String(error)).toContain(`could not listen on 127.0.0.1:${String(port)} (EADDRINUSE)`);
    } finally {
      taken.close();
    }
  });

  it('names the step that failed, never what the driver said', async () => {
    const password = 'synthetic-db-password-41c9';
    const config = loadConfig({
      ...SYNTHETIC_ENV,
      DATABASE_URL: `postgres://liasse:${password}@127.0.0.1:1/liasse`,
    });
    const error = await failureOf(createRuntime(config, { logger: createLogger(() => undefined) }));
    expect(error).toBeInstanceOf(StartupError);
    expect(String(error)).toMatch(/migrating the database failed \([A-Za-z]+ ECONNREFUSED\)\.$/);
    expect(String(error)).not.toContain(password);
  });
});
