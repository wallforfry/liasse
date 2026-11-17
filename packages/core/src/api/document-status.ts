import {
  DOCUMENT_STATUS_EVENTS,
  type DocumentJob,
  documentJobSchema,
  type DocumentStatusView,
  documentStatusSchema,
} from '@liasse/contract';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs, unfinishedJobOfDocument } from '../db/schema/jobs.ts';
import { processDocumentJob } from '../ingest/process-document-job.ts';
import {
  reclassifyDocumentJob,
  reextractDocumentJob,
  reindexDocumentJob,
} from '../pipeline/jobs.ts';
import { hasPendingWrite } from '../pipeline/pending-write.ts';
import type { ApiContext } from './context.ts';
import { listDocumentEvents } from './document-events.ts';
import { documentNotFound } from './errors.ts';

// The jobs that take a document through its stages. The others that name a document,
// such as link detection or the Hindsight sync, do not hold its status back.
const PROCESSING_KINDS = [
  processDocumentJob,
  reextractDocumentJob,
  reclassifyDocumentJob,
  reindexDocumentJob,
].map(({ name }) => name);

interface JobRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: Date;
  readonly runAfter: Date;
  readonly due: boolean;
}

// The due jobs a worker claims before this one, in the order of `claimJob`. Its own
// `run_after` is read by Postgres: a JavaScript date would lose the microseconds.
const countAhead = async (db: Database, id: string): Promise<number> =>
  db.$count(
    jobs,
    and(
      eq(jobs.status, 'queued'),
      lte(jobs.runAfter, sql`now()`),
      sql`(${jobs.runAfter}, ${jobs.id}) < (select mine.run_after, mine.id from ${jobs} as mine where mine.id = ${id})`,
    ),
  );

const toDocumentJob = (row: JobRow, ahead: number | null): DocumentJob => {
  const queued = row.status === 'queued';
  return documentJobSchema.parse({
    kind: row.kind,
    state: row.status,
    attempts: row.attempts,
    max_attempts: row.maxAttempts,
    queued_at: row.createdAt.toISOString(),
    run_after: row.runAfter.toISOString(),
    waiting_for: queued ? (row.due ? 'worker' : 'delay') : null,
    jobs_ahead: ahead,
  });
};

// The running job first, then the one due first. The clock is that of Postgres, which
// is the one `claimJob` compares `run_after` with.
const readProcessingJob = async (db: Database, documentId: string): Promise<DocumentJob | null> => {
  const [row] = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      createdAt: jobs.createdAt,
      runAfter: jobs.runAfter,
      due: sql<boolean>`${jobs.runAfter} <= now()`,
    })
    .from(jobs)
    .where(and(inArray(jobs.kind, PROCESSING_KINDS), unfinishedJobOfDocument(documentId)))
    .orderBy(sql`${jobs.status} = 'running' desc`, asc(jobs.runAfter), asc(jobs.id))
    .limit(1);
  if (row === undefined) return null;
  const waitsForWorker = row.status === 'queued' && row.due;
  return toDocumentJob(row, waitsForWorker ? await countAhead(db, row.id) : null);
};

/**
 * Where the processing of a document stands: its status, the end of its processing log,
 * and the job that takes it further, queued or running, with what a queued one waits
 * for. A document just received has no event until its first stage ends: its job says
 * whether it waits or runs. Rejects with `document_not_found` for an id that is unknown
 * or deleted; a private document is answered, as by `getDocument`.
 */
export const getDocumentStatus = async (
  { db }: Pick<ApiContext, 'db'>,
  id: string,
): Promise<DocumentStatusView> => {
  const [document] = await db
    .select({
      status: documents.status,
      state: documents.state,
      error: documents.error,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.id, id), isLiveDocument));
  if (document === undefined) throw documentNotFound();
  const [{ events }, analysisPending, job] = await Promise.all([
    listDocumentEvents({ db }, id, { last: DOCUMENT_STATUS_EVENTS }),
    hasPendingWrite(db, id),
    readProcessingJob(db, id),
  ]);
  return documentStatusSchema.parse({
    id,
    status: document.status,
    state: document.state,
    error: document.error,
    events,
    analysis_pending: analysisPending,
    updated_at: document.updatedAt.toISOString(),
    job,
  });
};
