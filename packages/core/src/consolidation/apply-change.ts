import type { AutoApplyMode } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import { READ_COMMITTED } from '../db/isolation.ts';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import { lockEntities } from '../entities/entity-lock.ts';
import { mergeEntities } from '../entities/merge.ts';
import { isMergeChangeKind } from '../entities/proposal-store.ts';
import { mergeSubjects } from '../knowledge/subject-merge.ts';
import {
  applyFieldRemoval,
  applyMerge,
  applyPromotion,
  applyStabilization,
} from './apply-type-changes.ts';
import {
  type ChangeTransaction,
  closeChange,
  findChangeKind,
  lockChange,
  markUnsafe,
  type StoredChange,
} from './change-store.ts';
import { isStillSafe } from './eligibility.ts';
import { type ConsolidationChange, readChange } from './payloads.ts';
import { appliesAutomatically } from './policy.ts';
import { ChangeRefusedError, orRefuse } from './refusal.ts';

export type Decision = 'apply' | 'reject';

export interface DecisionOutcome {
  readonly change: StoredChange;
  /** Re-extractions the application queued; 0 for a rejection. */
  readonly reextractions: number;
  /** Why an application was refused: the change is then rejected with this reason. */
  readonly refusal?: { readonly code: string; readonly message: string };
}

export type DecideResult =
  | { readonly outcome: 'decided'; readonly decided: DecisionOutcome }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'already_decided'; readonly change: StoredChange };

/** An application by the policy may also find the change no longer eligible. */
export type PolicyResult = DecideResult | { readonly outcome: 'not_eligible' };

const pair = ({
  source_id: sourceId,
  target_id: targetId,
}: {
  source_id: string;
  target_id: string;
}) => ({ sourceId, targetId });

// Each application runs in a savepoint of the transaction that holds the change: a
// refusal undoes what it wrote, and the change is rejected in the same transaction.
const apply = async (tx: ChangeTransaction, change: ConsolidationChange): Promise<number> => {
  switch (change.kind) {
    case 'merge':
      return applyMerge(tx, change.payload);
    case 'promote_field':
      return applyPromotion(tx, change.payload);
    case 'stabilize':
      return applyStabilization(tx, change.payload);
    case 'remove_field':
      return applyFieldRemoval(tx, change.payload);
    case 'merge_entity':
      orRefuse(await mergeEntities({ db: tx }, pair(change.payload)));
      return 0;
    case 'merge_subject':
      orRefuse(await mergeSubjects({ db: tx }, pair(change.payload)));
      return 0;
  }
};

interface Refusal {
  readonly code: string;
  readonly message: string;
}

const UNREADABLE: Refusal = {
  code: 'unsupported_change',
  message: 'This change has a kind or a payload consolidation cannot apply.',
};

const applyLocked = async (
  tx: ChangeTransaction,
  stored: StoredChange,
  note: string | null,
): Promise<DecisionOutcome> => {
  const refuse = async (refusal: Refusal): Promise<DecisionOutcome> => {
    const reason = `Not applicable: ${refusal.message}`;
    const recorded = note === null ? reason : `${note} ${reason}`;
    return {
      change: await closeChange(tx, stored.id, 'rejected', recorded),
      reextractions: 0,
      refusal,
    };
  };
  const change = readChange(stored.kind, stored.payload);
  if (change === undefined) return refuse(UNREADABLE);
  try {
    const reextractions = await tx.transaction((savepoint) => apply(savepoint, change));
    return { change: await closeChange(tx, stored.id, 'applied', note), reextractions };
  } catch (error) {
    if (!(error instanceof ChangeRefusedError)) throw error;
    return refuse({ code: error.code, message: error.message });
  }
};

// The row of a change is locked after the entity lock for a merge of entities or
// subjects: applying one rewrites the pending rows of the other merges, under that lock,
// so a decision holding its row while it waits for the lock would deadlock with another.
const lockPendingChange = async (
  tx: ChangeTransaction,
  id: string,
): Promise<StoredChange | undefined> => {
  if (!isId(ID_PREFIXES.typeChange, id)) return undefined;
  const kind = await findChangeKind(tx, id);
  if (kind === undefined) return undefined;
  if (isMergeChangeKind(kind)) await lockEntities(tx);
  return lockChange(tx, id);
};

// Runs `work` on a pending change whose row is locked until the transaction ends: one
// decision per change. The registry and entity locks are taken in this transaction too,
// which `withRegistryLock` requires to be read committed.
const onPendingChange = <Result extends PolicyResult>(
  db: Database,
  id: string,
  work: (tx: ChangeTransaction, stored: StoredChange) => Promise<Result>,
): Promise<Result | DecideResult> =>
  db.transaction(
    async (tx) => {
      const stored = await lockPendingChange(tx, id);
      if (stored === undefined) return { outcome: 'not_found' };
      if (stored.status !== 'pending') return { outcome: 'already_decided', change: stored };
      return work(tx, stored);
    },
    { isolationLevel: READ_COMMITTED },
  );

/**
 * Applies or rejects a pending change, once: the row of the change is locked for the
 * decision, and a change already decided is left as it is. An application the current
 * state refuses (a type merged meanwhile, an entity gone, two entities of different
 * kinds) rejects the change with the reason, so it is never tried again.
 */
export const decideChange = (
  db: Database,
  id: string,
  decision: Decision,
  note: string | null,
): Promise<DecideResult> =>
  onPendingChange(db, id, async (tx, stored): Promise<DecideResult> => ({
    outcome: 'decided',
    decided:
      decision === 'reject'
        ? { change: await closeChange(tx, id, 'rejected', note), reextractions: 0 }
        : await applyLocked(tx, stored, note),
  }));

/**
 * The application of a pending change by the auto-apply policy. Whether the change is
 * safe is read again under the lock of its row, from the registry as it is now: a change
 * that is no longer safe loses its `auto` flag, and `AUTO_APPLY=safe` leaves it pending.
 */
export const applyByPolicy = (
  db: Database,
  id: string,
  mode: AutoApplyMode,
): Promise<PolicyResult> =>
  onPendingChange(db, id, async (tx, stored): Promise<PolicyResult> => {
    const change = readChange(stored.kind, stored.payload);
    const safe = stored.auto && change !== undefined && (await isStillSafe(tx, change));
    if (stored.auto && !safe) await markUnsafe(tx, id);
    if (!appliesAutomatically(mode, safe)) return { outcome: 'not_eligible' };
    const note = `Applied automatically (AUTO_APPLY=${mode}).`;
    return { outcome: 'decided', decided: await applyLocked(tx, stored, note) };
  });
