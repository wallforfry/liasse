import type { Database } from '../db/client.ts';
import type { HindsightClient } from './client.ts';
import { type SyncSession, withDocumentSyncLock } from './document-lock.ts';
import {
  HindsightRetainInFlightError,
  HindsightSyncBusyError,
  HindsightSyncLockLostError,
} from './errors.ts';
import {
  buildRetainItem,
  retainHash,
  type RetainTarget,
  screenFacts,
  type SensitiveDetector,
} from './memory.ts';
import {
  readSyncState,
  recordForgotten,
  recordOutcomeUnknown,
  recordRetainAnswered,
  recordRetained,
  recordRetainStarted,
  type SyncState,
} from './sync-state.ts';
import type { RetainItem } from './wire.ts';

export interface HindsightSyncDeps {
  readonly db: Database;
  readonly client: HindsightClient;
  readonly target: RetainTarget;
  /**
   * Required: a fact is free text written by a model, and this is the only guard
   * between it and Hindsight. A fact it flags is left out of what is sent.
   */
  readonly isSensitive: SensitiveDetector;
}

export type HindsightSyncAction =
  /** The facts were retained, in place of what the bank held for the document. */
  | 'retained'
  /** Hindsight confirmed that it holds nothing of the document. */
  | 'forgotten'
  /** The bank already holds exactly these facts: no request was made. */
  | 'unchanged'
  /** Nothing to send, and nothing the bank may hold: no request was made. */
  | 'skipped';

export interface HindsightSyncResult {
  readonly action: HindsightSyncAction;
  /** Facts left out because the detector flagged them. */
  readonly withheldFacts: number;
}

interface SyncRun {
  readonly deps: HindsightSyncDeps;
  readonly session: SyncSession;
  readonly documentId: string;
  readonly signal: AbortSignal | undefined;
}

interface SyncPlan {
  /** Undefined when nothing of the document may be sent. */
  readonly item: RetainItem | undefined;
  readonly withheld: number;
}

const planOf = ({ isSensitive }: HindsightSyncDeps, state: SyncState): SyncPlan => {
  const sendsFacts = state.live && !state.private;
  const { sendable, withheld } = screenFacts(sendsFacts ? state.facts : [], isSensitive);
  return { item: buildRetainItem(state.document, sendable), withheld };
};

// Whatever came of the request, success included, it may have changed what the bank
// holds; the record says so before anything else is decided.
const sendRequest = async (run: SyncRun, request: () => Promise<unknown>): Promise<void> => {
  const failure = await request().then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  try {
    await recordOutcomeUnknown(run.session.db, run.documentId);
  } catch {
    // Only a broken connection fails this statement, and the lock went with it.
    throw new HindsightSyncLockLostError();
  }
  if (failure !== undefined) throw failure.error;
};

// The record is cleared after the answer and never before: a forget that fails leaves
// it set, which is what makes the forget owed and lets the sweep queue it again. A
// retain that may still land keeps it set as well, and the forget is owed once more.
const forget = async (run: SyncRun, state: SyncState): Promise<HindsightSyncAction> => {
  if (!state.mayHold) return 'skipped';
  await sendRequest(run, () => run.deps.client.forget(run.documentId, run.signal));
  const retainingMs = await recordForgotten(run.session, run.documentId);
  if (retainingMs !== undefined && retainingMs > 0) {
    throw new HindsightRetainInFlightError(retainingMs);
  }
  return 'forgotten';
};

// The hash is recorded only when the facts are still the ones sent. Otherwise it stays
// null, and the next sync sends the facts again.
const confirmRetained = async (run: SyncRun, sentHash: string): Promise<void> => {
  const current = await readSyncState(run.session.db, run.documentId);
  const { item } = current === undefined ? { item: undefined } : planOf(run.deps, current);
  if (item === undefined || retainHash(run.deps.target, item) !== sentHash) return;
  await recordRetained(run.session, run.documentId, sentHash);
};

const retain = async (
  run: SyncRun,
  state: SyncState,
  item: RetainItem,
): Promise<HindsightSyncAction> => {
  const hash = retainHash(run.deps.target, item);
  if (hash === state.sentHash) return 'unchanged';
  // Committed before the request: whatever becomes of it, a timeout after Hindsight
  // stored the facts included, the row says the bank may hold them. A document deleted
  // or flagged private since it was read is left to the sync queued by that change.
  const { client } = run.deps;
  if (!(await recordRetainStarted(run.session, run.documentId, client.requestWindowMs))) {
    return 'skipped';
  }
  await sendRequest(run, () => client.retain(item, run.signal));
  await recordRetainAnswered(run.session, run.documentId, state.retainUntil);
  await confirmRetained(run, hash);
  return 'retained';
};

const syncLocked = async (run: SyncRun): Promise<HindsightSyncResult> => {
  const state = await readSyncState(run.session.db, run.documentId);
  if (state === undefined) return { action: 'skipped', withheldFacts: 0 };
  const { item, withheld } = planOf(run.deps, state);
  const action = item === undefined ? await forget(run, state) : await retain(run, state, item);
  return { action, withheldFacts: withheld };
};

/**
 * Brings what Hindsight holds for a document in line with Liasse, and is safe to run
 * any number of times. The facts of a live document that is not private are retained
 * when they differ from the ones Hindsight confirmed. A document that is deleted,
 * private or left without a fact to send is forgotten when the bank may hold facts of
 * it, which `documents.hindsight_held_since` says.
 *
 * It runs on one connection of the pool, with no transaction open during a request.
 * Syncs of one document exclude each other; the one that finds another in progress
 * throws a `HindsightSyncBusyError`. One that loses its lock with its connection
 * records that the bank may hold anything and throws a `HindsightSyncLockLostError`.
 * A forget that a retain may still overtake keeps its record and throws a
 * `HindsightRetainInFlightError`. The queue tries all three again.
 */
export const syncDocumentToHindsight = async (
  deps: HindsightSyncDeps,
  documentId: string,
  signal?: AbortSignal,
): Promise<HindsightSyncResult> => {
  try {
    const result = await withDocumentSyncLock(deps.db, documentId, (session) =>
      syncLocked({ deps, session, documentId, signal }),
    );
    if (result === undefined) throw new HindsightSyncBusyError();
    return result;
  } catch (error) {
    // The connection of the sync is gone, and the sync holds no other now: the record
    // goes through the pool.
    if (error instanceof HindsightSyncLockLostError) {
      await recordOutcomeUnknown(deps.db, documentId);
    }
    throw error;
  }
};
