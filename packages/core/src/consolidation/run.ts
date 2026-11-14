import { asc, eq } from 'drizzle-orm';
import { typeChanges } from '../db/schema/registry.ts';
import type { ChangeKind } from '../domain/enums.ts';
import { decideChange } from './apply-change.ts';
import type { ConsolidationContext } from './context.ts';
import { appliesAutomatically } from './policy.ts';
import { proposeIdentityMerges } from './propose-identity-merges.ts';
import { proposeCleanups, proposeStabilizations } from './propose-lifecycle.ts';
import { proposeMerges } from './propose-merges.ts';
import { proposePromotions } from './propose-promotions.ts';
import { findTypeMergeCandidates } from './type-merge-candidates.ts';
import { loadTypeProfiles } from './type-profiles.ts';

export interface ConsolidationReport {
  /** Changes this run recorded, pending or not. */
  readonly proposed: number;
  readonly applied: number;
  /** Changes applied automatically that the current state refused, and rejected. */
  readonly refused: number;
  readonly reextractions: number;
}

const APPLICATION_ORDER: readonly ChangeKind[] = [
  'merge_entity',
  'merge_subject',
  'merge',
  'promote_field',
  'remove_field',
  'stabilize',
];

interface Applied {
  readonly applied: number;
  readonly refused: number;
  readonly reextractions: number;
}

/**
 * Step 5 for the changes the policy applies without approval, those of earlier runs and
 * of entity resolution included. Merges go first: a stabilization or a promotion of a
 * type merged meanwhile is then refused, never applied to the wrong type.
 */
const applyAutomatic = async (
  { db, autoApply }: ConsolidationContext,
  signal?: AbortSignal,
): Promise<Applied> => {
  const pending = await db
    .select({ id: typeChanges.id, kind: typeChanges.kind, auto: typeChanges.auto })
    .from(typeChanges)
    .where(eq(typeChanges.status, 'pending'))
    .orderBy(asc(typeChanges.id));
  const due = pending
    .filter(({ auto }) => appliesAutomatically(autoApply, auto))
    .toSorted((a, b) => APPLICATION_ORDER.indexOf(a.kind) - APPLICATION_ORDER.indexOf(b.kind));
  const note = `Applied automatically (AUTO_APPLY=${autoApply}).`;
  let applied = 0;
  let refused = 0;
  let reextractions = 0;
  for (const { id } of due) {
    signal?.throwIfAborted();
    const result = await decideChange(db, id, 'apply', note);
    if (result.outcome !== 'decided') continue;
    if (result.decided.refusal === undefined) applied += 1;
    else refused += 1;
    reextractions += result.decided.reextractions;
  }
  return { applied, refused, reextractions };
};

/**
 * One run of consolidation: merge candidates, field promotion, stabilization and
 * cleanup each record their proposals, then the policy applies what needs no approval.
 * The counts are read once, before the proposals: a run works on the registry as it
 * found it, and the next one sees what this one changed.
 */
export const runConsolidation = async (
  context: ConsolidationContext,
  signal?: AbortSignal,
): Promise<ConsolidationReport> => {
  const { db } = context;
  const profiles = await loadTypeProfiles(db);
  const merges = await proposeMerges(context, await findTypeMergeCandidates(db, profiles), signal);
  const promotions = await proposePromotions(context, profiles, signal);
  const stabilizations = await proposeStabilizations(db, profiles);
  const cleanups = await proposeCleanups(db, profiles);
  const identities = await proposeIdentityMerges(db);
  const { applied, refused, reextractions } = await applyAutomatic(context, signal);
  return {
    proposed:
      merges.length + promotions.length + stabilizations.length + cleanups.length + identities,
    applied,
    refused,
    reextractions,
  };
};
