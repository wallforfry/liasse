import type { Database } from '../db/client.ts';
import { READ_COMMITTED } from '../db/isolation.ts';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import { mergeEntities } from '../entities/merge.ts';
import { mergeSubjects } from '../knowledge/subject-merge.ts';
import {
  applyFieldRemoval,
  applyMerge,
  applyPromotion,
  applyStabilization,
  ChangeRefusedError,
  orRefuse,
} from './apply-type-changes.ts';
import {
  type ChangeTransaction,
  closeChange,
  lockChange,
  type StoredChange,
} from './change-store.ts';
import { type ConsolidationChange, readChange } from './payloads.ts';

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
  db.transaction(
    async (tx) => {
      const stored = isId(ID_PREFIXES.typeChange, id) ? await lockChange(tx, id) : undefined;
      if (stored === undefined) return { outcome: 'not_found' };
      if (stored.status !== 'pending') return { outcome: 'already_decided', change: stored };
      if (decision === 'reject') {
        return {
          outcome: 'decided',
          decided: { change: await closeChange(tx, id, 'rejected', note), reextractions: 0 },
        };
      }
      return { outcome: 'decided', decided: await applyLocked(tx, stored, note) };
    },
    // The registry and entity locks are taken in this transaction: see `withRegistryLock`.
    { isolationLevel: READ_COMMITTED },
  );
