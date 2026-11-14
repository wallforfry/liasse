import type { Database } from '../db/client.ts';
import type { HindsightClient } from './client.ts';
import { withDocumentSyncLock } from './document-lock.ts';
import { HindsightSyncBusyError } from './errors.ts';
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
  readonly documentId: string;
  readonly signal: AbortSignal | undefined;
}

// The record is cleared after the answer and never before: a forget that fails leaves
// it set, which is what makes the forget owed and lets the sweep queue it again.
const forget = async (
  { deps, documentId, signal }: SyncRun,
  state: SyncState,
): Promise<HindsightSyncAction> => {
  if (!state.mayHold) return 'skipped';
  await deps.client.forget(documentId, signal);
  await recordForgotten(deps.db, documentId);
  return 'forgotten';
};

const retain = async (
  { deps, documentId, signal }: SyncRun,
  state: SyncState,
  item: RetainItem,
): Promise<HindsightSyncAction> => {
  const hash = retainHash(deps.target, item);
  if (hash === state.sentHash) return 'unchanged';
  // Committed before the request: whatever becomes of it, a timeout after Hindsight
  // stored the facts included, the row says the bank may hold them.
  const started = await recordRetainStarted(deps.db, documentId);
  // Deleted or flagged private since it was read: the sync queued by that change
  // decides, on a row that says what the bank may hold.
  if (!started) return 'skipped';
  await deps.client.retain(item, signal);
  await recordRetained(deps.db, documentId, hash);
  return 'retained';
};

const syncLocked = async (run: SyncRun): Promise<HindsightSyncResult> => {
  const state = await readSyncState(run.deps.db, run.documentId);
  if (state === undefined) return { action: 'skipped', withheldFacts: 0 };
  const sendsFacts = state.live && !state.private;
  const { sendable, withheld } = screenFacts(sendsFacts ? state.facts : [], run.deps.isSensitive);
  const item = buildRetainItem(state.document, sendable);
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
 * No transaction is open during a request: each write is one statement, committed on
 * its own. Syncs of one document exclude each other; the one that finds another in
 * progress throws a `HindsightSyncBusyError`, for the queue to try again.
 */
export const syncDocumentToHindsight = async (
  deps: HindsightSyncDeps,
  documentId: string,
  signal?: AbortSignal,
): Promise<HindsightSyncResult> => {
  const result = await withDocumentSyncLock(deps.db, documentId, () =>
    syncLocked({ deps, documentId, signal }),
  );
  if (result === undefined) throw new HindsightSyncBusyError();
  return result;
};
