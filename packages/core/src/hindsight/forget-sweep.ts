import { TOMBSTONE_STATUS } from '@liasse/contract/domain';
import { and, eq, inArray, isNotNull, notExists, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { jobs } from '../db/schema/jobs.ts';
import { enqueueHindsightSync, hindsightSyncJob } from './sync-job.ts';

export interface HindsightForgetSweepDeps {
  readonly db: Database;
}

export interface HindsightForgetSweepOptions {
  /** How many syncs one call queues at most. */
  readonly limit?: number;
}

const DEFAULT_LIMIT = 500;

/**
 * For startup, when the integration is enabled. A `hindsight_sync` job gives up after
 * its attempts (about ten minutes with the default backoff) or at once when Hindsight
 * refuses the request, and an outage or a wrong key can last longer: the facts of a
 * deleted or private document would then stay in Hindsight for good. This queues a
 * sync again for every tombstone and every private document whose row says the bank
 * may hold its facts (`hindsight_held_since` is set) and that has no `hindsight_sync`
 * job queued or running. Resolves to the number of syncs queued.
 *
 * It asks Hindsight nothing. It is safe to call at every start and from several
 * processes: a sync queued twice forgets once and then finds nothing owed.
 */
export const requeueHindsightForgets = async (
  { db }: HindsightForgetSweepDeps,
  { limit = DEFAULT_LIMIT }: HindsightForgetSweepOptions = {},
): Promise<number> => {
  const syncInProgress = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, hindsightSyncJob.name),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.payload}->>'documentId' = ${documents.id}`,
      ),
    );
  const owed = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        isNotNull(documents.hindsightHeldSince),
        or(eq(documents.status, TOMBSTONE_STATUS), eq(documents.private, true)),
        notExists(syncInProgress),
      ),
    )
    .orderBy(documents.hindsightHeldSince, documents.id)
    .limit(limit);
  for (const { id } of owed) {
    await enqueueHindsightSync(db, id);
  }
  return owed.length;
};
