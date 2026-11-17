import type { ConsolidationRunView } from '@liasse/contract';
import { consolidationTriggerSchema, MAX_LISTED_CONSOLIDATION_RUNS } from '@liasse/contract/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import { consolidateJob } from './schedule.ts';

// The nightly run queued for a later hour: it is the schedule, not a run anyone waits for.
// One that failed an attempt counts again, since it waits for its retry.
const scheduledNightly = sql`(${jobs.payload} ->> 'trigger' = 'nightly' and ${jobs.status} = 'queued'
  and ${jobs.attempts} = 0 and ${jobs.runAfter} > now())`;

/** The latest runs of consolidation, newest first, read from the job queue. */
export const recentConsolidationRuns = async (
  db: Database,
): Promise<readonly ConsolidationRunView[]> => {
  const rows = await db
    .select({
      id: jobs.id,
      trigger: sql<unknown>`${jobs.payload} ->> 'trigger'`,
      status: jobs.status,
      attempts: jobs.attempts,
      createdAt: jobs.createdAt,
      runAfter: jobs.runAfter,
      lastError: jobs.lastError,
    })
    .from(jobs)
    .where(and(eq(jobs.kind, consolidateJob.name), sql`not ${scheduledNightly}`))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(MAX_LISTED_CONSOLIDATION_RUNS);
  return rows.map((row) => ({
    id: row.id,
    trigger: consolidationTriggerSchema.parse(row.trigger),
    status: row.status,
    attempts: row.attempts,
    queued_at: row.createdAt.toISOString(),
    due_at: row.runAfter.toISOString(),
    last_error: row.lastError,
  }));
};
