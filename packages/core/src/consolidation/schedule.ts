import {
  CONSOLIDATION_BATCH_DOCUMENTS,
  CONSOLIDATION_NIGHTLY_HOUR_UTC,
  SETTLED_STATUSES,
} from '@liasse/contract/domain';
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { defineJobKind } from '../jobs/kinds.ts';

export const CONSOLIDATION_TRIGGERS = ['nightly', 'batch'] as const;
export type ConsolidationTrigger = (typeof CONSOLIDATION_TRIGGERS)[number];

/**
 * One run of consolidation. A `nightly` run queues the next one when it starts, so the
 * chain survives a run that fails; a `batch` run is queued once enough new documents
 * settled since the last run. Two runs never overlap: the kind runs one at a time.
 */
export const consolidateJob = defineJobKind({
  name: 'consolidate',
  schema: z.object({ trigger: z.enum(CONSOLIDATION_TRIGGERS) }),
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

const queued = (trigger: ConsolidationTrigger) =>
  and(
    eq(jobs.kind, consolidateJob.name),
    eq(jobs.status, 'queued'),
    sql`${jobs.payload} ->> 'trigger' = ${trigger}`,
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
 * last run started have settled, unless a run is queued. Called after each indexing: it
 * reads two counts and writes nothing else. Answers whether it queued one.
 */
export const queueBatchRunIfDue = (db: Database): Promise<boolean> =>
  withScheduleLock(db, async (tx) => {
    if ((await tx.$count(jobs, queued('batch'))) > 0) return false;
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
