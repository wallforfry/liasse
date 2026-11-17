import type {
  ChangeDecision,
  ChangeDecisionResult,
  ChangeList,
  ConsolidationRun,
  ConsolidationRunList,
  ListChangesOptions,
} from '@liasse/contract';
import { MAX_LISTED_CHANGES } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { ApiError } from '../api/errors.ts';
import { typeChanges } from '../db/schema/registry.ts';
import { decideChange } from './apply-change.ts';
import { pendingChanges } from './change-store.ts';
import type { ConsolidationReadContext } from './context.ts';
import { recentConsolidationRuns } from './runs.ts';
import { queueManualRun } from './schedule.ts';
import { viewChange, viewDecision } from './views.ts';

/** The pending changes, oldest first, at most `MAX_LISTED_CHANGES`. */
export const listChanges = async (
  { db }: ConsolidationReadContext,
  { kind }: ListChangesOptions,
): Promise<ChangeList> => {
  const rows = await pendingChanges(
    db,
    kind === undefined ? undefined : eq(typeChanges.kind, kind),
    MAX_LISTED_CHANGES + 1,
  );
  return {
    changes: rows.slice(0, MAX_LISTED_CHANGES).map(viewChange),
    truncated: rows.length > MAX_LISTED_CHANGES,
  };
};

/**
 * `apply_change`: a person's decision on a pending change. Undefined for an id no change
 * has; a change already applied or rejected is refused with its status.
 */
export const applyChange = async (
  { db }: ConsolidationReadContext,
  id: string,
  { decision, note }: ChangeDecision,
): Promise<ChangeDecisionResult | undefined> => {
  const result = await decideChange(db, id, decision, note ?? null);
  switch (result.outcome) {
    case 'not_found':
      return undefined;
    case 'already_decided':
      throw new ApiError(
        'invalid',
        'change_already_decided',
        `This change was already ${result.change.status}.`,
        { status: result.change.status },
      );
    case 'decided':
      return viewDecision(result.decided);
  }
};

/** A person asks for a run now; it runs on a worker, after a run in progress. */
export const requestConsolidationRun = async ({
  db,
}: ConsolidationReadContext): Promise<ConsolidationRun> => ({ queued: await queueManualRun(db) });

/** The latest runs, newest first, the next nightly one left out until it is due. */
export const listConsolidationRuns = async ({
  db,
}: ConsolidationReadContext): Promise<ConsolidationRunList> => ({
  runs: [...(await recentConsolidationRuns(db))],
});
