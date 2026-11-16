import { DeferJobError } from '../jobs/errors.ts';
import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import type { ConsolidationContext } from './context.ts';
import { runConsolidation } from './run.ts';
import { withConsolidationRunLock } from './run-lock.ts';
import { consolidateJob, scheduleNightlyRun } from './schedule.ts';

/**
 * The handler of `consolidate`, for `startWorkers`. A nightly run queues the next one
 * first, whatever becomes of it. A run that finds another one in progress, in any
 * process, ends at once: that run does the same work. A manual run is deferred instead:
 * the run in progress may have read the registry before what the person wants seen.
 */
export const createConsolidationHandlers = (
  context: ConsolidationContext,
): readonly RegisteredHandler[] => [
  handle(consolidateJob, async ({ payload, signal }) => {
    if (payload.trigger === 'nightly') await scheduleNightlyRun(context.db);
    const report = await withConsolidationRunLock(context.db, () =>
      runConsolidation(context, signal),
    );
    if (report === undefined && payload.trigger === 'manual') {
      throw new DeferJobError('Another consolidation run is in progress.');
    }
  }),
];

/** Runs of one process never overlap; `withConsolidationRunLock` covers the others. */
export const CONSOLIDATION_CONCURRENCY: Readonly<Record<string, number>> = {
  [consolidateJob.name]: 1,
};
