import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import { pollSource, type SourcePollDeps } from './poll.ts';
import { SOURCE_POLL_CONCURRENCY, sourcePollJob } from './schedule.ts';

export const createSourceHandlers = (deps: SourcePollDeps): readonly RegisteredHandler[] => [
  handle(sourcePollJob, ({ payload, signal }) => pollSource(deps, payload.sourceId, signal)),
];

/** To spread into the `perKindConcurrency` of the workers. */
export const SOURCE_CONCURRENCY: Readonly<Record<string, number>> = {
  [sourcePollJob.name]: SOURCE_POLL_CONCURRENCY,
};
