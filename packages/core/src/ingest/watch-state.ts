/**
 * What the watcher remembers of one path. The fingerprint ties every state to one
 * version of the file: a file that changes starts over, whatever happened to it before.
 *
 * - `settling`: seen, and waited on until it has stopped changing for the stability delay.
 * - `handled`: ingested, a duplicate, or refused for what it is. Never read again.
 * - `failed`: ingestion failed for a reason unrelated to the file (database or storage
 *   down). Read again at `retryAt`, one rescan interval later.
 */
export type WatchState =
  | { readonly phase: 'settling'; readonly fingerprint: string; readonly since: number }
  | { readonly phase: 'handled'; readonly fingerprint: string }
  | { readonly phase: 'failed'; readonly fingerprint: string; readonly retryAt: number };

export type WatchDecision =
  { readonly ingest: true } | { readonly ingest: false; readonly state: WatchState };

export const decide = (
  previous: WatchState | undefined,
  fingerprint: string,
  now: number,
  stabilityMs: number,
): WatchDecision => {
  if (previous?.fingerprint !== fingerprint) {
    return { ingest: false, state: { phase: 'settling', fingerprint, since: now } };
  }
  const due =
    (previous.phase === 'settling' && now - previous.since >= stabilityMs) ||
    (previous.phase === 'failed' && now >= previous.retryAt);
  return due ? { ingest: true } : { ingest: false, state: previous };
};
