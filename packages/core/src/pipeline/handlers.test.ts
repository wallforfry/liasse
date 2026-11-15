import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentEvents } from '../db/schema/document-events.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { deleteDocument } from '../ingest/delete-document.ts';
import { ingestFile } from '../ingest/ingest-file.ts';
import { processDocumentJob } from '../ingest/process-document-job.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { createHandlerRegistry, type RegisteredHandler } from '../jobs/handlers.ts';
import { recoverStaleJobs, terminalFailureHooks } from '../jobs/store.ts';
import { startWorkers } from '../jobs/workers.ts';
import { ModelOutputError, ModelProviderError } from '../models/errors.ts';
import { waitUntil } from '../testing/async.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { syntheticPdf } from '../testing/synthetic-files.ts';
import { TextExtractionError } from '../text/errors.ts';
import type { PipelineDeps } from './deps.ts';
import { failAbandonedDocuments } from './abandoned.ts';
import { createPipelineHandlers } from './handlers.ts';
import {
  createPipelineHarness,
  live,
  type PipelineHarness,
  scriptedModel,
} from './harness.test-helper.ts';
import { reextractDocumentJob, reindexDocumentJob } from './jobs.ts';
import { processDocument } from './process-document.ts';

const SECRET = 'text of the document that must not leak';

describe('the job handlers of the pipeline', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const handlerOf = (deps: PipelineDeps, kind: string): RegisteredHandler => {
    const handler = createPipelineHandlers(deps).find((candidate) => candidate.kind === kind);
    if (handler === undefined) throw new Error(`No handler for ${kind}`);
    return handler;
  };

  const run = (deps: PipelineDeps, documentId: string, attempt = 1, signal = live()) =>
    handlerOf(deps, processDocumentJob.name).run({ documentId }, { signal, attempt });

  const failingText = (error: Error) => harness.deps({ extractText: () => Promise.reject(error) });

  it('registers one handler per job kind of the pipeline', () => {
    expect(createPipelineHandlers(harness.deps()).map(({ kind }) => kind)).toEqual([
      'process_document',
      'reextract_document',
      'reindex_document',
    ]);
    expect(processDocumentJob.maxAttempts).toBe(3);
    expect(reextractDocumentJob.maxAttempts).toBe(3);
    expect(reindexDocumentJob.maxAttempts).toBe(3);
  });

  it('fails the document at once, with the code alone, on a failure another attempt would meet', async () => {
    const id = await harness.ingest('encrypted');
    const failure = run(failingText(new TextExtractionError('pdf_encrypted', SECRET)), id);
    await expect(failure).rejects.toBeInstanceOf(PermanentJobError);
    await expect(failure).rejects.not.toThrow(SECRET);
    expect(await harness.document(id)).toMatchObject({ status: 'failed', error: 'pdf_encrypted' });
  });

  it('leaves the document on its way while the job has attempts left', async () => {
    const id = await harness.ingest('retryable');
    const error = new TextExtractionError('pdf_renderer_timeout', SECRET);
    await expect(run(failingText(error), id, 2)).rejects.toBe(error);
    expect(await harness.document(id)).toMatchObject({ status: 'received', error: null });
  });

  it('fails the document when the last attempt fails, whatever the error', async () => {
    const id = await harness.ingest('exhausted');
    const error = new TextExtractionError('pdf_renderer_timeout', SECRET);
    await expect(run(failingText(error), id, 3)).rejects.toBe(error);
    expect(await harness.document(id)).toMatchObject({
      status: 'failed',
      error: 'pdf_renderer_timeout',
    });
  });

  it.each([
    [
      new ModelProviderError({ provider: 'p', model: 'm', retryable: false }),
      1,
      'failed',
      'model_provider_failed',
    ],
    [new ModelProviderError({ provider: 'p', model: 'm', retryable: true }), 1, 'extracted', null],
    [new ModelOutputError('m', SECRET), 1, 'extracted', null],
    [new ModelOutputError('m', SECRET), 3, 'failed', 'model_output_invalid'],
    [new Error(SECRET), 3, 'failed', 'internal_error'],
  ])(
    'a model failing with %s at attempt %i leaves the document %s',
    async (error, attempt, status, code) => {
      const id = await harness.ingest('model failure');
      const deps = harness.deps({
        textModel: scriptedModel({
          classify: () => {
            throw error;
          },
        }),
      });
      await expect(run(deps, id, attempt)).rejects.toBeDefined();
      expect(await harness.document(id)).toMatchObject({ status, error: code });
    },
  );

  it('marks nothing when the job was interrupted: it goes back to the queue uncounted', async () => {
    const id = await harness.ingest('interrupted');
    const controller = new AbortController();
    const deps = harness.deps({
      extractText: () => {
        controller.abort(new Error('the workers are stopping'));
        return Promise.reject(new TextExtractionError('pdf_encrypted', SECRET));
      },
    });
    await expect(run(deps, id, 3, controller.signal)).rejects.toBeDefined();
    expect(await harness.document(id)).toMatchObject({ status: 'received', error: null });
  });

  it('never fails a document that is settled, even on the last attempt', async () => {
    const id = await harness.ingest('hook down');
    await run(harness.deps(), id);
    const { status } = await harness.document(id);
    const deps = harness.deps({
      afterIndexed: () => Promise.reject(new Error('the hook is down')),
    });
    await expect(run(deps, id, 3)).rejects.toThrow('the hook is down');
    expect(await harness.document(id)).toMatchObject({ status, error: null });
  });

  it('flags for review a re-extraction whose last attempt fails, and leaves a re-indexing be', async () => {
    const id = await harness.ingest('settled');
    await run(harness.deps(), id);
    const before = await harness.document(id);
    const deps = harness.deps({
      indexDocument: () => Promise.reject(new Error('the index is down')),
    });
    const runKind = (kind: string, attempt: number) =>
      handlerOf(deps, kind).run({ documentId: id }, { signal: live(), attempt });
    await expect(runKind(reindexDocumentJob.name, 3)).rejects.toThrow('the index is down');
    await expect(runKind(reextractDocumentJob.name, 2)).rejects.toThrow('the index is down');
    expect(await harness.document(id)).toMatchObject({ status: before.status, error: null });
    await expect(runKind(reextractDocumentJob.name, 3)).rejects.toThrow('the index is down');
    expect(await harness.document(id)).toMatchObject({
      status: 'needs_review',
      error: 'reextraction_failed',
    });
  });

  it('ends a re-extraction or a re-indexing at once on a failure another attempt cannot fix', async () => {
    const id = await harness.ingest('refused');
    await run(harness.deps(), id);
    const refusal = new ModelProviderError({ provider: 'p', model: 'm', retryable: false });
    const deps = harness.deps({ indexDocument: () => Promise.reject(refusal) });
    for (const kind of [reextractDocumentJob.name, reindexDocumentJob.name]) {
      await expect(
        handlerOf(deps, kind).run({ documentId: id }, { signal: live(), attempt: 1 }),
      ).rejects.toBeInstanceOf(PermanentJobError);
    }
    const failures = await harness.db
      .select()
      .from(documentEvents)
      .where(and(eq(documentEvents.documentId, id), ne(documentEvents.outcome, 'succeeded')))
      .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id));
    expect(failures).toMatchObject([
      {
        stage: 'reextraction',
        outcome: 'failed',
        status: 'needs_review',
        attempt: 1,
        errorCode: 'model_provider_failed',
        retryable: false,
      },
      {
        stage: 'indexing',
        outcome: 'failed',
        status: 'needs_review',
        attempt: 1,
        errorCode: 'model_provider_failed',
        retryable: false,
      },
    ]);
  });

  it('re-indexes a settled document and runs the hook, and leaves one on its way alone', async () => {
    const settled = await harness.ingest('to reindex');
    await run(harness.deps(), settled);
    const waiting = await harness.ingest('on its way');
    const hooked: string[] = [];
    const deps = harness.deps({ afterIndexed: (id) => Promise.resolve(void hooked.push(id)) });
    for (const documentId of [settled, waiting, 'doc_MISSING']) {
      await handlerOf(deps, reindexDocumentJob.name).run(
        { documentId },
        { signal: live(), attempt: 1 },
      );
    }
    expect(harness.indexed).toEqual([settled, settled]);
    expect(hooked).toEqual([settled]);
  });

  it('processes a queued document through the real workers', async () => {
    const id = await harness.ingest('queued');
    const workers = await startWorkers({
      db: harness.db,
      handlers: createPipelineHandlers(harness.deps()),
      concurrency: 2,
      pollIntervalMs: 20,
    });
    try {
      await waitUntil(async () => (await harness.document(id)).status !== 'received');
      await waitUntil(async () =>
        ['indexed', 'needs_review'].includes((await harness.document(id)).status),
      );
    } finally {
      await workers.stop();
    }
    // Link detection is queued with the settled document; its handler is not this module's.
    const queued = await harness.db.select({ kind: jobs.kind, status: jobs.status }).from(jobs);
    expect(queued.toSorted((left, right) => left.kind.localeCompare(right.kind))).toEqual([
      { kind: 'detect_links', status: 'queued' },
      { kind: 'process_document', status: 'succeeded' },
    ]);
  });

  it('queues link detection again after a re-extraction, and not after a re-indexing', async () => {
    const id = await harness.ingest('extracted again');
    await run(harness.deps(), id);
    const detections = async () =>
      (await harness.db.select({ kind: jobs.kind }).from(jobs)).filter(
        ({ kind }) => kind === 'detect_links',
      ).length;
    expect(await detections()).toBe(1);
    for (const kind of [reindexDocumentJob.name, reextractDocumentJob.name]) {
      await handlerOf(harness.deps(), kind).run({ documentId: id }, { signal: live(), attempt: 1 });
    }
    expect(await detections()).toBe(2);
  });
});

describe('failAbandonedDocuments', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  it('fails the documents on their way that no queued or running job will take further', async () => {
    const { db } = harness;
    const make = async (status: 'received' | 'extracted' | 'classified' | 'indexed' | 'failed') =>
      (await insertSyntheticDocument(db, { status })).id;
    const job = async (
      documentId: string,
      status: 'queued' | 'running' | 'failed' | 'succeeded',
    ) => {
      const id = await enqueue(db, { kind: processDocumentJob, payload: { documentId } });
      await db.update(jobs).set({ status }).where(eq(jobs.id, id));
    };
    const abandoned = [await make('received'), await make('extracted'), await make('classified')];
    await job(abandoned[0] ?? '', 'failed');
    await job(abandoned[1] ?? '', 'succeeded');
    const queued = await make('received');
    await job(queued, 'failed');
    await job(queued, 'queued');
    const running = await make('classified');
    await job(running, 'running');
    const settled = await make('indexed');
    const failed = await make('failed');
    const otherKind = await make('extracted');
    await enqueue(db, { kind: reextractDocumentJob, payload: { documentId: otherKind } });

    expect(await failAbandonedDocuments(db)).toBe(4);
    const rows = await db.select().from(documents);
    const statusOf = (id: string) => rows.find((row) => row.id === id);
    for (const id of [...abandoned, otherKind]) {
      expect(statusOf(id)).toMatchObject({ status: 'failed', error: 'processing_abandoned' });
    }
    expect(statusOf(queued)).toMatchObject({ status: 'received', error: null });
    expect(statusOf(running)).toMatchObject({ status: 'classified', error: null });
    expect(statusOf(settled)).toMatchObject({ status: 'indexed', error: null });
    expect(statusOf(failed)).toMatchObject({ status: 'failed', error: null });
    expect(await failAbandonedDocuments(db)).toBe(0);
  });
});

const processDocumentNow = (harness: PipelineHarness, id: string): Promise<void> =>
  processDocument(harness.deps(), id, live());

describe('a document whose job the queue fails by itself', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.reset();
  });

  afterAll(async () => {
    await harness.dispose();
  });

  const hooks = () =>
    terminalFailureHooks(createHandlerRegistry(createPipelineHandlers(harness.deps())));

  // Verdict P1: a worker dies during the last attempt and the server is back within the
  // visibility timeout. The sweep at startup still sees the job running; the recovery
  // fails it later.
  it('ends failed when the recovery fails the last attempt of process_document', async () => {
    const id = await harness.ingest('stuck');
    await harness.db.update(jobs).set({ status: 'running', attempts: 3, lockedAt: sql`now()` });
    expect(await failAbandonedDocuments(harness.db)).toBe(0);
    await harness.db.update(jobs).set({ lockedAt: sql`now() - interval '10 minutes'` });
    expect(await recoverStaleJobs(harness.db, 300_000, hooks())).toBe(1);
    expect(await harness.document(id)).toMatchObject({
      status: 'failed',
      error: 'processing_abandoned',
    });
    // An upload of the same bytes now queues it again, as for any failed document.
    const again = await ingestFile(harness.ingestHarness.deps, {
      bytes: syntheticPdf('stuck'),
      filename: 'stuck.pdf',
      source: 'api',
    });
    expect(again).toMatchObject({ id, status: 'received' });
  });

  it('keeps the code the handler gave when the last attempt fails in it', async () => {
    const id = await harness.ingest('encrypted');
    const deps = harness.deps({
      extractText: () => Promise.reject(new TextExtractionError('pdf_encrypted', 'locked')),
    });
    const workers = await startWorkers({
      db: harness.db,
      handlers: createPipelineHandlers(deps),
      concurrency: 1,
      pollIntervalMs: 20,
    });
    try {
      await waitUntil(async () => (await harness.document(id)).status === 'failed');
    } finally {
      await workers.stop();
    }
    expect(await harness.document(id)).toMatchObject({ error: 'pdf_encrypted' });
  });

  it('leaves a settled document indexed but flagged when its re-extraction fails for good', async () => {
    const id = await harness.ingest('reextract');
    await processDocumentNow(harness, id);
    const jobId = await enqueue(harness.db, {
      kind: reextractDocumentJob,
      payload: { documentId: id },
    });
    await harness.db
      .update(jobs)
      .set({ status: 'running', attempts: 3, lockedAt: sql`now() - interval '10 minutes'` })
      .where(eq(jobs.id, jobId));
    expect(await recoverStaleJobs(harness.db, 300_000, hooks())).toBe(1);
    expect(await harness.document(id)).toMatchObject({
      status: 'needs_review',
      error: 'reextraction_failed',
    });
    // A re-extraction that succeeds later takes the flag away.
    const reextract = createPipelineHandlers(harness.deps()).find(
      ({ kind }) => kind === reextractDocumentJob.name,
    );
    await reextract?.run({ documentId: id }, { signal: live(), attempt: 1 });
    expect(await harness.document(id)).toMatchObject({ error: null });
  });

  it('does nothing to a document that is gone, nor for a payload without one', async () => {
    const id = await harness.ingest('gone');
    await deleteDocument({ db: harness.db }, id);
    await harness.db.insert(jobs).values([
      { kind: processDocumentJob.name, payload: { documentId: id } },
      { kind: processDocumentJob.name, payload: { nothing: true } },
    ]);
    await harness.db
      .update(jobs)
      .set({ status: 'running', attempts: 3, lockedAt: sql`now() - interval '10 minutes'` })
      .where(eq(jobs.kind, processDocumentJob.name));
    expect(await recoverStaleJobs(harness.db, 300_000, hooks())).toBe(2);
    expect(await harness.document(id)).toMatchObject({ status: 'deleted', error: null });
  });
});
