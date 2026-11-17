import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { facts } from '../db/schema/knowledge.ts';
import { DeferJobError, PermanentJobError } from '../jobs/errors.ts';
import type { JobDeferral } from '../jobs/execution.ts';
import { startWorkers, type Workers, type WorkersOptions } from '../jobs/workers.ts';
import { createGate, waitUntil } from '../testing/async.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { createHindsightClient } from './client.ts';
import { flagsSyntheticIdentifiers, SYNTHETIC_IDENTIFIER } from './detector.test-helper.ts';
import {
  HindsightError,
  HindsightRetainInFlightError,
  HindsightSyncBusyError,
  HindsightSyncLockLostError,
} from './errors.ts';
import { type HindsightStub, startHindsightStub, type StubOverride } from './stub.test-helper.ts';
import {
  createHindsightSyncHandler,
  enqueueHindsightSync,
  HINDSIGHT_SYNC_CONCURRENCY,
  hindsightSyncJob,
  type WithheldFacts,
} from './sync-job.ts';

const NEVER_ABORTED = new AbortController().signal;
const MARKER = 'synthetic-fact-marker';

describe('the hindsight_sync job', () => {
  let database: TestDatabase;
  let stub: HindsightStub;
  let override: StubOverride | undefined;
  const started: Workers[] = [];

  const withheld: WithheldFacts[] = [];

  const handler = () =>
    createHindsightSyncHandler({
      db: database.db,
      client: createHindsightClient(
        { url: stub.url, bank: 'documents', apiKey: undefined },
        { retries: 0, retryDelayMs: 1 },
      ),
      target: { url: stub.url, bank: 'documents' },
      isSensitive: flagsSyntheticIdentifiers,
      onFactsWithheld: (report) => {
        withheld.push(report);
      },
    });

  const run = (payload: unknown, signal: AbortSignal = NEVER_ABORTED) =>
    handler().run(payload, { signal, attempt: 1 });

  const documentWithFact = async (): Promise<string> => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    await database.db.insert(facts).values({ documentId: id, text: `A ${MARKER} fact.` });
    return id;
  };

  const jobRow = async (id: string) => {
    const [job] = await database.db.select().from(jobs).where(eq(jobs.id, id));
    if (job === undefined) throw new Error(`The job ${id} does not exist`);
    return job;
  };

  const work = async (options: Pick<WorkersOptions, 'onJobDeferred'> = {}): Promise<void> => {
    started.push(
      await startWorkers({
        db: database.db,
        handlers: () => ({ handlers: [handler()] }),
        concurrency: 2,
        pollIntervalMs: 20,
        maxPollIntervalMs: 40,
        retry: { baseMs: 10, maxMs: 20 },
        ...options,
      }),
    );
  };

  const flagPrivate = async (id: string): Promise<void> => {
    await database.db.update(documents).set({ private: true }).where(eq(documents.id, id));
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    stub = await startHindsightStub({ override: (call, index) => override?.(call, index) });
  });

  afterEach(async () => {
    await Promise.all(
      started.splice(0).map((workers) => workers.stop({ timeoutMs: 0, abortGraceMs: 500 })),
    );
    override = undefined;
    withheld.splice(0);
    await database.db.delete(jobs);
    await database.db.delete(documents);
  });

  afterAll(async () => {
    await stub.close();
    await database.dispose();
  });

  it('is queued with the document id, in the transaction of the caller', async () => {
    const id = await documentWithFact();
    await database.db
      .transaction(async (tx) => {
        await enqueueHindsightSync(tx, id);
        throw new Error('synthetic rollback');
      })
      .catch(() => undefined);
    expect(await database.db.select().from(jobs)).toEqual([]);

    const jobId = await enqueueHindsightSync(database.db, id);
    expect(await jobRow(jobId)).toMatchObject({
      kind: 'hindsight_sync',
      payload: { documentId: id },
      status: 'queued',
      maxAttempts: 8,
    });
    expect(hindsightSyncJob.name).toBe('hindsight_sync');
  });

  it('refuses a payload without a document id', async () => {
    await expect(run({ documentId: '' })).rejects.toBeInstanceOf(PermanentJobError);
    await expect(enqueueHindsightSync(database.db, '')).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('syncs the document of its payload', async () => {
    const id = await documentWithFact();
    await run({ documentId: id });
    expect(stub.documents.get(`documents/${id}`)).toBe(`[doc:${id}] A ${MARKER} fact.`);
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'fails for good when Hindsight refuses the request with a %i',
    async (status) => {
      const id = await documentWithFact();
      override = ({ body }) => ({ status, body: { detail: [{ input: body }] } });
      const error: unknown = await run({ documentId: id }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PermanentJobError);
      expect(error).toMatchObject({ message: `Hindsight retain failed (HTTP ${String(status)})` });
      expect(String(error)).not.toContain(MARKER);
    },
  );

  it.each([408, 429, 500, 503])('leaves a %i to the retries of the queue', async (status) => {
    const id = await documentWithFact();
    override = () => ({ status, body: { detail: 'synthetic failure' } });
    const error: unknown = await run({ documentId: id }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HindsightError);
    expect(error).not.toBeInstanceOf(PermanentJobError);
  });

  it('reports the facts the detector kept out, and nothing when it kept none out', async () => {
    const id = await documentWithFact();
    await run({ documentId: id });
    expect(withheld).toEqual([]);
    await database.db
      .insert(facts)
      .values({ documentId: id, text: `Paid from account ${SYNTHETIC_IDENTIFIER}.` });
    await run({ documentId: id });
    expect(withheld).toEqual([{ documentId: id, count: 1 }]);
    expect(stub.documents.get(`documents/${id}`)).toBe(`[doc:${id}] A ${MARKER} fact.`);
  });

  it('defers a document whose sync is in progress, without a delay of its own', async () => {
    const id = await documentWithFact();
    override = () => 'hang';
    const controller = new AbortController();
    const before = stub.calls.length;
    const first = run({ documentId: id }, controller.signal);
    await waitUntil(() => stub.calls.length === before + 1);
    const error: unknown = await run({ documentId: id }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferJobError);
    expect(error).toMatchObject({ delayMs: undefined });
    expect(error).toHaveProperty('cause', expect.any(HindsightSyncBusyError));
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
  });

  it('defers a forget a retain may still overtake until that retain can no longer land', async () => {
    const id = await documentWithFact();
    override = () => ({ status: 503, body: { detail: 'synthetic failure' } });
    await expect(run({ documentId: id })).rejects.toBeInstanceOf(HindsightError);
    override = undefined;
    await flagPrivate(id);
    const error: unknown = await run({ documentId: id }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferJobError);
    expect(error).toHaveProperty('cause', expect.any(HindsightRetainInFlightError));
    // The client of this test makes one attempt of two minutes at most, and the bound
    // adds a margin of ten seconds for the time before the request leaves.
    expect(error).toHaveProperty('delayMs', expect.any(Number));
    const { delayMs } = z.object({ delayMs: z.number() }).parse(error);
    expect(delayMs).toBeGreaterThan(120_000);
    expect(delayMs).toBeLessThanOrEqual(130_000);
  });

  it('waits for the sync in progress without spending an attempt', async () => {
    const id = await documentWithFact();
    override = () => 'hang';
    const controller = new AbortController();
    const before = stub.calls.length;
    const first = run({ documentId: id }, controller.signal);
    await waitUntil(() => stub.calls.length === before + 1);
    const deferrals: JobDeferral[] = [];
    const jobId = await enqueueHindsightSync(database.db, id);
    await work({ onJobDeferred: (deferral) => deferrals.push(deferral) });
    // More deferrals than the 8 attempts of the kind.
    await waitUntil(() => deferrals.length > 8);
    override = undefined;
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    await waitUntil(async () => (await jobRow(jobId)).status === 'succeeded');
    expect(await jobRow(jobId)).toMatchObject({ attempts: 1, lastError: null });
  });

  it('retains again after a lost lock without spending an attempt', async () => {
    const id = await documentWithFact();
    const received = createGate();
    const proceed = createGate();
    let held = false;
    override = async () => {
      if (held) return undefined;
      held = true;
      received.open();
      await proceed.opened;
      return undefined;
    };
    const deferrals: JobDeferral[] = [];
    const jobId = await enqueueHindsightSync(database.db, id);
    await work({ onJobDeferred: (deferral) => deferrals.push(deferral) });
    await received.opened;
    // Ends the backend that holds the sync lock, as a restart or a network cut would.
    const ended = await database.db.execute<{ ended: boolean }>(
      sql`SELECT pg_terminate_backend(pid) AS ended FROM pg_locks
        WHERE locktype = 'advisory' AND granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );
    expect([...ended]).toEqual([{ ended: true }]);
    proceed.open();
    await waitUntil(async () => (await jobRow(jobId)).status === 'succeeded');
    expect(deferrals).toHaveLength(1);
    expect(deferrals[0]?.error).toHaveProperty('cause', expect.any(HindsightSyncLockLostError));
    expect(await jobRow(jobId)).toMatchObject({ attempts: 1, lastError: null });
  });

  it('states the cap the workers must apply to its kind', () => {
    expect(HINDSIGHT_SYNC_CONCURRENCY).toBe(2);
  });

  it('stops its request when the workers abort it', async () => {
    const id = await documentWithFact();
    override = () => 'hang';
    const controller = new AbortController();
    const before = stub.calls.length;
    const running = run({ documentId: id }, controller.signal);
    await waitUntil(() => stub.calls.length === before + 1);
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'aborted' });
  });

  it('is retried by the workers until Hindsight answers', async () => {
    const id = await documentWithFact();
    const first = stub.calls.length;
    override = (_, index) =>
      index === first ? { status: 503, body: { detail: 'synthetic failure' } } : undefined;
    const jobId = await enqueueHindsightSync(database.db, id);
    await work();
    await waitUntil(async () => (await jobRow(jobId)).status === 'succeeded');
    expect((await jobRow(jobId)).attempts).toBe(2);
    expect(stub.documents.has(`documents/${id}`)).toBe(true);
  });

  it('fails at its first attempt on a refusal, with an error that quotes nothing', async () => {
    const id = await documentWithFact();
    override = ({ body }) => ({ status: 422, body: { detail: [{ input: body }] } });
    const jobId = await enqueueHindsightSync(database.db, id);
    await work();
    await waitUntil(async () => (await jobRow(jobId)).status === 'failed');
    expect(await jobRow(jobId)).toMatchObject({
      attempts: 1,
      lastError: 'PermanentJobError: Hindsight retain failed (HTTP 422)',
    });
  });
});
