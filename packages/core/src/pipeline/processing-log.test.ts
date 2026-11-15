import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { documentEvents } from '../db/schema/document-events.ts';
import { jobs } from '../db/schema/jobs.ts';
import { processDocumentJob } from '../ingest/process-document-job.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { createHandlerRegistry, type RegisteredHandler } from '../jobs/handlers.ts';
import { recoverStaleJobs, terminalFailureHooks } from '../jobs/store.ts';
import { ModelProviderError } from '../models/errors.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { TextExtractionError } from '../text/errors.ts';
import { failAbandonedDocuments } from './abandoned.ts';
import type { PipelineDeps } from './deps.ts';
import { createPipelineHandlers } from './handlers.ts';
import {
  createPipelineHarness,
  live,
  type PipelineHarness,
  scriptedModel,
} from './harness.test-helper.ts';
import { reextractDocumentJob, reindexDocumentJob } from './jobs.ts';

const SECRET = 'text of the document that must not leak';

describe('the processing log of a document', () => {
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

  const eventsOf = (documentId: string) =>
    harness.db
      .select()
      .from(documentEvents)
      .where(eq(documentEvents.documentId, documentId))
      .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id));

  const handlerOf = (deps: PipelineDeps, kind: string): RegisteredHandler => {
    const handler = createPipelineHandlers(deps).find((candidate) => candidate.kind === kind);
    if (handler === undefined) throw new Error(`No handler for ${kind}`);
    return handler;
  };

  const run = (deps: PipelineDeps, kind: string, documentId: string, attempt: number) =>
    handlerOf(deps, kind).run({ documentId }, { signal: live(), attempt });

  const classifyFailing = (error: Error) =>
    harness.deps({
      textModel: scriptedModel({
        classify: () => {
          throw error;
        },
      }),
    });

  it('logs each stage of a processing that succeeds, with its model and counts', async () => {
    const id = await harness.ingest('logged');
    await run(harness.deps(), processDocumentJob.name, id, 1);
    const events = await eventsOf(id);
    expect(events.map(({ stage, outcome }) => [stage, outcome])).toEqual([
      ['text', 'succeeded'],
      ['classification', 'succeeded'],
      ['extraction', 'succeeded'],
      ['indexing', 'succeeded'],
    ]);
    const [text, classification, extraction, indexing] = events;
    expect(text).toMatchObject({ status: 'extracted', details: { pages: 1 } });
    expect(classification).toMatchObject({
      status: 'classified',
      model: 'fake-text-model',
      details: { classification: 'new' },
    });
    expect(extraction).toMatchObject({
      status: 'classified',
      model: 'fake-text-model',
      details: { rejected_values: 0, truncated: false },
    });
    expect(indexing?.status).toMatch(/^(indexed|needs_review)$/);
  });

  it('logs an attempt that will run again, then the last one, with codes and never a message', async () => {
    const id = await harness.ingest('failing');
    const retryable = new ModelProviderError({ provider: 'p', model: 'm', retryable: true });
    await expect(
      run(classifyFailing(retryable), processDocumentJob.name, id, 1),
    ).rejects.toBeDefined();
    await expect(
      run(classifyFailing(new Error(SECRET)), processDocumentJob.name, id, 3),
    ).rejects.toBeDefined();
    const failures = (await eventsOf(id)).filter(({ outcome }) => outcome !== 'succeeded');
    expect(failures).toMatchObject([
      {
        stage: 'classification',
        outcome: 'retrying',
        status: 'extracted',
        attempt: 1,
        maxAttempts: 3,
        errorCode: 'model_provider_failed',
        errorName: 'ModelProviderError',
        retryable: true,
      },
      {
        stage: 'classification',
        outcome: 'failed',
        status: 'failed',
        attempt: 3,
        errorCode: 'internal_error',
        errorName: 'Error',
        retryable: true,
      },
    ]);
    expect(JSON.stringify(await eventsOf(id))).not.toContain(SECRET);
  });

  it('logs a failure another attempt cannot fix as final, at the first attempt', async () => {
    const id = await harness.ingest('encrypted');
    const deps = harness.deps({
      extractText: () => Promise.reject(new TextExtractionError('pdf_encrypted', SECRET)),
    });
    await expect(run(deps, processDocumentJob.name, id, 1)).rejects.toBeDefined();
    expect(await eventsOf(id)).toMatchObject([
      { stage: 'text', outcome: 'failed', errorCode: 'pdf_encrypted', retryable: false },
    ]);
  });

  it('logs nothing for an interrupted attempt, which goes back to the queue uncounted', async () => {
    const id = await harness.ingest('interrupted');
    const controller = new AbortController();
    const deps = harness.deps({
      extractText: () => {
        controller.abort(new Error('the workers are stopping'));
        return Promise.reject(new TextExtractionError('pdf_encrypted', SECRET));
      },
    });
    await expect(
      handlerOf(deps, processDocumentJob.name).run(
        { documentId: id },
        { signal: controller.signal, attempt: 1 },
      ),
    ).rejects.toBeDefined();
    expect(await eventsOf(id)).toEqual([]);
  });

  it('logs the attempts of a re-extraction and of a re-indexing, leaving the document as it was', async () => {
    const id = await harness.ingest('settled');
    await run(harness.deps(), processDocumentJob.name, id, 1);
    const before = await harness.document(id);
    const deps = harness.deps({
      indexDocument: () => Promise.reject(new Error('the index is down')),
    });
    await expect(run(deps, reextractDocumentJob.name, id, 1)).rejects.toBeDefined();
    await expect(run(deps, reindexDocumentJob.name, id, 3)).rejects.toBeDefined();
    const failures = (await eventsOf(id)).filter(({ outcome }) => outcome !== 'succeeded');
    expect(failures).toMatchObject([
      { stage: 'reextraction', outcome: 'retrying', status: before.status, attempt: 1 },
      { stage: 'indexing', outcome: 'failed', status: before.status, attempt: 3 },
    ]);
    expect(await harness.document(id)).toMatchObject({ status: before.status, error: null });
  });

  it('logs the flag of a re-extraction whose worker died, not of one its handler logged', async () => {
    const id = await harness.ingest('reextracted');
    await run(harness.deps(), processDocumentJob.name, id, 1);
    const logged = (await eventsOf(id)).length;
    const hook = reextractDocumentJob.onTerminalFailure;
    if (hook === undefined) throw new Error('reextract_document has no terminal hook');
    const fail = (cause: 'error' | 'stale') =>
      harness.db.transaction((tx) =>
        hook(tx, { jobId: 'job_X', payload: { documentId: id }, cause, attempt: 3 }),
      );
    await fail('error');
    expect(await harness.document(id)).toMatchObject({
      status: 'needs_review',
      error: 'reextraction_failed',
    });
    expect(await eventsOf(id)).toHaveLength(logged);
    await fail('stale');
    expect((await eventsOf(id)).slice(logged)).toMatchObject([
      {
        stage: 'reextraction',
        outcome: 'failed',
        status: 'needs_review',
        errorCode: 'processing_abandoned',
        attempt: 3,
      },
    ]);
  });

  it('logs the failure of a document whose worker died during its last attempt', async () => {
    const id = await harness.ingest('stuck');
    await harness.db
      .update(jobs)
      .set({ status: 'running', attempts: 3, lockedAt: sql`now() - interval '10 minutes'` });
    const hooks = terminalFailureHooks(
      createHandlerRegistry(createPipelineHandlers(harness.deps())),
    );
    expect(await recoverStaleJobs(harness.db, 300_000, hooks)).toBe(1);
    expect(await eventsOf(id)).toMatchObject([
      {
        stage: 'text',
        outcome: 'failed',
        status: 'failed',
        errorCode: 'processing_abandoned',
        attempt: 3,
        maxAttempts: 3,
      },
    ]);
  });

  it('logs the documents failed at startup because no job will take them further', async () => {
    const { id } = await insertSyntheticDocument(harness.db, { status: 'extracted' });
    const queued = await insertSyntheticDocument(harness.db, { status: 'received' });
    await enqueue(harness.db, { kind: processDocumentJob, payload: { documentId: queued.id } });
    expect(await failAbandonedDocuments(harness.db)).toBe(1);
    expect(await eventsOf(id)).toMatchObject([
      {
        stage: 'classification',
        outcome: 'failed',
        status: 'failed',
        errorCode: 'processing_abandoned',
      },
    ]);
    expect(await eventsOf(queued.id)).toEqual([]);
  });
});
