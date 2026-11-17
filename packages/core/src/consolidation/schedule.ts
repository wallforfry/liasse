import {
  CONSOLIDATION_BATCH_DOCUMENTS,
  type ConsolidationTrigger,
  consolidationTriggerSchema,
  CONSOLIDATION_NIGHTLY_HOUR_UTC,
  SETTLED_STATUSES,
} from '@liasse/contract/domain';
import { and, desc, eq, gt, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { defineJobKind } from '../jobs/kinds.ts';

/**
 * One run of consolidation. A `nightly` run queues the next one when it starts, so the
 * chain survives a run that fails; a `batch` run is queued once enough new documents
 * settled since the last run; a `manual` run is asked for by a person. Two runs never
 * overlap: the kind runs one at a time.
 */
export const consolidateJob = defineJobKind({
  name: 'consolidate',
  schema: z.object({ trigger: consolidationTriggerSchema }),
});

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// The check and the enqueue of a run are made under this lock, so two settling documents
// never both queue one.
const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.consolidation-schedule'))`;

const withScheduleLock = <Outcome>(db: Database, work: (tx: Transaction) => Promise<Outcome>) =>
  db.transaction(async (tx) => {
    await tx.execute(LOCK);
    return work(tx);
  });

const queued = (...triggers: readonly ConsolidationTrigger[]) =>
  and(
    eq(jobs.kind, consolidateJob.name),
    eq(jobs.status, 'queued'),
    inArray(sql`${jobs.payload} ->> 'trigger'`, [...triggers]),
  );

/** The next nightly hour strictly after `now`. */
export const nextNightlyRun = (now: Date): Date => {
  const today = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      CONSOLIDATION_NIGHTLY_HOUR_UTC,
    ),
  );
  return today > now ? today : new Date(today.getTime() + 24 * 60 * 60 * 1000);
};

/**
 * Queues the next nightly run unless one is queued. Called at startup and by each
 * nightly run as it starts. Answers whether it queued one.
 */
export const scheduleNightlyRun = (db: Database, now: Date = new Date()): Promise<boolean> =>
  withScheduleLock(db, async (tx) => {
    if ((await tx.$count(jobs, queued('nightly'))) > 0) return false;
    await enqueue(tx, {
      kind: consolidateJob,
      payload: { trigger: 'nightly' },
      runAfter: nextNightlyRun(now),
    });
    return true;
  });

// When the last run started: the `run_after` of the latest run that left the queue, the
// moment it became due. Null before the first run.
const lastRunStart = async (tx: Transaction): Promise<Date | null> => {
  const [row] = await tx
    .select({ at: jobs.runAfter })
    .from(jobs)
    .where(and(eq(jobs.kind, consolidateJob.name), ne(jobs.status, 'queued')))
    .orderBy(desc(jobs.runAfter))
    .limit(1);
  return row?.at ?? null;
};

/**
 * Queues a `batch` run once `CONSOLIDATION_BATCH_DOCUMENTS` documents ingested since the
 * last run started have settled, unless a `batch` or `manual` run is queued. Called after each indexing: it
 * reads two counts and writes nothing else. Answers whether it queued one.
 */
export const queueBatchRunIfDue = (db: Database): Promise<boolean> =>
  withScheduleLock(db, async (tx) => {
    if ((await tx.$count(jobs, queued('batch', 'manual'))) > 0) return false;
    const since = await lastRunStart(tx);
    const fresh = await tx.$count(
      documents,
      and(
        isLiveDocument,
        inArray(documents.status, [...SETTLED_STATUSES]),
        since === null ? undefined : gt(documents.ingestedAt, since),
      ),
    );
    if (fresh < CONSOLIDATION_BATCH_DOCUMENTS) return false;
    await enqueue(tx, { kind: consolidateJob, payload: { trigger: 'batch' } });
    return true;
  });

/**
 * Queues a `manual` run, due at once, unless a `manual` run is queued, deferred behind a
 * run in progress included, or a `batch` run due at once is: it does the same work. A
 * run in progress does not count, since it may have read the registry before what the
 * person wants it to see, and neither does a batch run waiting for a retry. Answers
 * whether it queued one.
 */
export const queueManualRun = (db: Database): Promise<boolean> =>
  withScheduleLock(db, async (tx) => {
    const waiting = or(queued('manual'), and(queued('batch'), lte(jobs.runAfter, sql`now()`)));
    if ((await tx.$count(jobs, waiting)) > 0) return false;
    await enqueue(tx, { kind: consolidateJob, payload: { trigger: 'manual' } });
    return true;
  });
