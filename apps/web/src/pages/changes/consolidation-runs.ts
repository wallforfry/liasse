import type { ConsolidationRunView } from '@liasse/sdk';
import { POLL_MILLISECONDS } from '../../lib/processing.ts';

export const CONSOLIDATION_RUNS_QUERY_KEY = ['consolidation-runs'] as const;

type Run = Pick<ConsolidationRunView, 'id' | 'status'>;

/** Queued, deferred or waiting for a retry, or running: its outcome is still to come. */
export const isUnfinished = ({ status }: Run): boolean =>
  status === 'queued' || status === 'running';

/** How often to read the runs again: while one of them has not finished. */
export const pollRuns = (runs: readonly Run[] | undefined): number | false =>
  runs?.some(isUnfinished) === true ? POLL_MILLISECONDS : false;

export const unfinishedIds = (runs: readonly Run[]): ReadonlySet<string> =>
  new Set(runs.filter(isUnfinished).map(({ id }) => id));

export const listedIds = (runs: readonly Run[]): ReadonlySet<string> =>
  new Set(runs.map(({ id }) => id));

/** What the page knew of the runs when it last read them. */
export interface SeenRuns {
  readonly unfinished: ReadonlySet<string>;
  /**
   * Every run listed when the person asked for one, or null. A run missing from it is the
   * one asked for, which may have finished before the page read it unfinished.
   */
  readonly listedBeforeRequest: ReadonlySet<string> | null;
}

/** The runs that have finished since the page last read them, oldest first. */
export const finishedSince = <Listed extends Run>(
  { unfinished, listedBeforeRequest }: SeenRuns,
  runs: readonly Listed[],
): readonly Listed[] =>
  runs
    .filter(
      (run) =>
        !isUnfinished(run) &&
        (unfinished.has(run.id) ||
          (listedBeforeRequest !== null && !listedBeforeRequest.has(run.id))),
    )
    .toReversed();
