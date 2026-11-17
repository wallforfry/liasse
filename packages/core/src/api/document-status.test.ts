import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { recordDocumentEvent } from '../processing-log/record.ts';
import { insertSyntheticDocument } from '../testing/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.ts';
import { getDocumentStatus } from './document-status.ts';
import { ApiError } from './errors.ts';

const refusalOf = async (work: Promise<unknown>): Promise<ApiError> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected an ApiError');
};

describe('getDocumentStatus', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(jobs);
  });

  afterAll(async () => {
    await database.dispose();
  });

  const queue = async (
    documentId: string,
    { kind = 'process_document', runAfter = sql`now()` } = {},
  ): Promise<string> => {
    const [job] = await database.db
      .insert(jobs)
      .values({ kind, payload: { documentId }, runAfter })
      .returning({ id: jobs.id });
    if (job === undefined) throw new Error('The job was not inserted');
    return job.id;
  };

  it('says a document just received waits for a worker, behind the jobs due before it', async () => {
    const { id: earlier } = await insertSyntheticDocument(database.db);
    await queue(earlier, { runAfter: sql`now() - interval '1 hour'` });
    const { id } = await insertSyntheticDocument(database.db);
    await queue(id);
    const status = await getDocumentStatus(database, id);
    expect(status).toMatchObject({
      id,
      status: 'received',
      state: 'current',
      error: null,
      events: [],
      analysis_pending: true,
      job: {
        kind: 'process_document',
        state: 'queued',
        attempts: 0,
        max_attempts: 3,
        waiting_for: 'worker',
        jobs_ahead: 1,
      },
    });
    expect((await getDocumentStatus(database, earlier)).job).toMatchObject({ jobs_ahead: 0 });
  });

  it('says a job waits for its delay, then that it runs, with its attempts', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'extracted' });
    const job = await queue(id, { runAfter: sql`now() + interval '1 hour'` });
    expect((await getDocumentStatus(database, id)).job).toMatchObject({
      state: 'queued',
      waiting_for: 'delay',
      jobs_ahead: null,
    });
    await database.db
      .update(jobs)
      .set({ status: 'running', attempts: 2, lockedAt: sql`now()` })
      .where(eq(jobs.id, job));
    expect((await getDocumentStatus(database, id)).job).toMatchObject({
      kind: 'process_document',
      state: 'running',
      attempts: 2,
      waiting_for: null,
      jobs_ahead: null,
    });
  });

  it('reports the re-extraction of a settled document, and no job once it is done', async () => {
    const { id, updatedAt } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    expect(await getDocumentStatus(database, id)).toMatchObject({
      status: 'indexed',
      analysis_pending: false,
      updated_at: updatedAt.toISOString(),
      job: null,
    });
    const job = await queue(id, { kind: 'reextract_document' });
    expect(await getDocumentStatus(database, id)).toMatchObject({
      status: 'indexed',
      analysis_pending: true,
      job: { kind: 'reextract_document', state: 'queued' },
    });
    await database.db.update(jobs).set({ status: 'succeeded' }).where(eq(jobs.id, job));
    expect((await getDocumentStatus(database, id)).job).toBeNull();
  });

  it('leaves out a job of the document that does not process it', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'indexed' });
    await queue(id, { kind: 'detect_links' });
    expect(await getDocumentStatus(database, id)).toMatchObject({
      analysis_pending: false,
      job: null,
    });
  });

  it('gives the last events of the log, oldest first', async () => {
    const { id } = await insertSyntheticDocument(database.db, { status: 'failed' });
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      await database.db.transaction((tx) =>
        recordDocumentEvent(tx, id, { stage: 'text', outcome: 'retrying', attempt }),
      );
    }
    const { events } = await getDocumentStatus(database, id);
    expect(events.map(({ attempt }) => attempt)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('answers document_not_found for an unknown or deleted document', async () => {
    const { id } = await insertSyntheticDocument(database.db);
    await database.db.update(documents).set({ status: 'deleted' }).where(eq(documents.id, id));
    for (const missing of [id, 'doc_01JC0000000000000000000000']) {
      expect(await refusalOf(getDocumentStatus(database, missing))).toMatchObject({
        kind: 'not_found',
        code: 'document_not_found',
      });
    }
  });
});
