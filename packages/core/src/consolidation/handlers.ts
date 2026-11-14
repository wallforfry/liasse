import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import type { ConsolidationContext } from './context.ts';
import { runConsolidation } from './run.ts';
import { consolidateJob, scheduleNightlyRun } from './schedule.ts';

/** The handler of `consolidate`, for `startWorkers`. */
export const createConsolidationHandlers = (
  context: ConsolidationContext,
): readonly RegisteredHandler[] => [
  handle(consolidateJob, async ({ payload, signal }) => {
    if (payload.trigger === 'nightly') await scheduleNightlyRun(context.db);
    await runConsolidation(context, signal);
  }),
];

/** Runs of consolidation never overlap: two runs would propose the same changes twice. */
export const CONSOLIDATION_CONCURRENCY: Readonly<Record<string, number>> = {
  [consolidateJob.name]: 1,
};
