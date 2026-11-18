import { and, eq, lte, notExists, type SQLWrapper, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import { ingestionSources } from '../db/schema/sources.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { defineJobKind, type JobTransaction } from '../jobs/kinds.ts';

/**
 * One run of a source. A run queues the next one when it starts, `poll_interval_minutes`
 * later, so the chain survives a run that fails; a save of the source or a person asking
 * queues one due at once.
 */
export const sourcePollJob = defineJobKind({
  name: 'source_poll',
  schema: z.object({ sourceId: z.string() }),
});

/**
 * Upper bound of runs in parallel within one process: a run holds a database connection
 * for its lock and another for its writes, and a large first import must not keep every
 * worker from processing the documents it brings.
 */
export const SOURCE_POLL_CONCURRENCY = 2;

type Executor = Pick<Database, 'select' | 'insert' | 'delete' | 'execute'>;

const queuedPollOf = (sourceId: SQLWrapper | string) =>
  and(
    eq(jobs.kind, sourcePollJob.name),
    eq(jobs.status, 'queued'),
    sql`${jobs.payload} ->> 'sourceId' = ${sourceId}`,
  );

// The check and the enqueue of a run are made under this lock, so two callers never both
// queue one for the same source.
const lockSchedule = (tx: JobTransaction, sourceId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`liasse.source-schedule:${sourceId}`}))`);

/** Queues a run at `runAfter` unless one is queued. Answers whether it queued one. */
export const scheduleNextPoll = (
  db: Database,
  sourceId: string,
  runAfter: Date,
): Promise<boolean> =>
  db.transaction(async (tx) => {
    await lockSchedule(tx, sourceId);
    if ((await tx.$count(jobs, queuedPollOf(sourceId))) > 0) return false;
    await enqueue(tx, { kind: sourcePollJob, payload: { sourceId }, runAfter });
    return true;
  });

/** Queues a run due at once unless one due at once is queued. Answers whether it queued one. */
export const queuePollNow = async (tx: JobTransaction, sourceId: string): Promise<boolean> => {
  await lockSchedule(tx, sourceId);
  const due = and(queuedPollOf(sourceId), lte(jobs.runAfter, sql`now()`));
  if ((await tx.$count(jobs, due)) > 0) return false;
  await enqueue(tx, { kind: sourcePollJob, payload: { sourceId } });
  return true;
};

/** Removes the queued runs of a source; a run in progress ends on its own. */
export const cancelPolls = async (tx: Executor, sourceId: string): Promise<void> => {
  await tx.delete(jobs).where(queuedPollOf(sourceId));
};

/**
 * Queues a run due at once for every enabled source that has none queued and does not wait
 * for a person. Called at startup: it restarts a chain that a run failed for good broke.
 */
export const seedSourcePolls = (db: Database): Promise<number> =>
  db.transaction(async (tx) => {
    const sources = await tx
      .select({ id: ingestionSources.id })
      .from(ingestionSources)
      .where(
        and(
          eq(ingestionSources.enabled, true),
          eq(ingestionSources.needsAttention, false),
          notExists(tx.select({ id: jobs.id }).from(jobs).where(queuedPollOf(ingestionSources.id))),
        ),
      );
    for (const { id } of sources)
      await enqueue(tx, { kind: sourcePollJob, payload: { sourceId: id } });
    return sources.length;
  });
