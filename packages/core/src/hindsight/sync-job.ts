import { z } from 'zod';
import { enqueue, type JobExecutor } from '../jobs/enqueue.ts';
import { PermanentJobError } from '../jobs/errors.ts';
import { handle, type RegisteredHandler } from '../jobs/handlers.ts';
import { defineJobKind } from '../jobs/kinds.ts';
import { HindsightError } from './errors.ts';
import { type HindsightSyncDeps, syncDocumentToHindsight } from './sync-document.ts';

// With the default backoff, eight attempts span about ten minutes. A forget that gives
// up after them stays owed on the row, and `requeueHindsightForgets` queues it again.
const HINDSIGHT_SYNC_ATTEMPTS = 8;

/**
 * One kind for every change of a document that Hindsight must follow: indexed,
 * extracted again, flagged private, deleted. The handler reads the document and decides
 * between a retain and a forget, so a job never carries a decision that went stale
 * while it waited.
 */
export const hindsightSyncJob = defineJobKind({
  name: 'hindsight_sync',
  schema: z.object({ documentId: z.string().min(1) }),
  maxAttempts: HINDSIGHT_SYNC_ATTEMPTS,
});

/**
 * The most `hindsight_sync` jobs the workers may run at once: the value to give
 * `perKindConcurrency` for this kind. A sync in flight holds one database connection,
 * its only one, for as long as Hindsight takes to answer (up to three attempts of two
 * minutes each). Any number of syncs is correct; the cap keeps a stalled Hindsight and
 * a backlog of syncs from taking the connections the rest of the server needs.
 */
export const HINDSIGHT_SYNC_CONCURRENCY = 2;

/** Queues a sync in the caller's transaction, so it commits with the change it follows. */
export const enqueueHindsightSync = (executor: JobExecutor, documentId: string): Promise<string> =>
  enqueue(executor, { kind: hindsightSyncJob, payload: { documentId } });

export interface WithheldFacts {
  readonly documentId: string;
  readonly count: number;
}

export interface HindsightSyncHandlerDeps extends HindsightSyncDeps {
  /** Called when the detector kept facts of a document out of what was sent. */
  readonly onFactsWithheld?: (withheld: WithheldFacts) => void;
}

/**
 * The handler the server registers for `hindsightSyncJob`. A failure another attempt
 * can get past (network, timeout, 408, 429, 5xx, another sync of the document in
 * progress) is left to the retries of the queue; a request Hindsight refuses fails the
 * job at once.
 */
export const createHindsightSyncHandler = ({
  onFactsWithheld,
  ...deps
}: HindsightSyncHandlerDeps): RegisteredHandler =>
  handle(hindsightSyncJob, async ({ payload, signal }) => {
    try {
      const { withheldFacts } = await syncDocumentToHindsight(deps, payload.documentId, signal);
      if (withheldFacts > 0) {
        onFactsWithheld?.({ documentId: payload.documentId, count: withheldFacts });
      }
    } catch (error) {
      if (error instanceof HindsightError && !error.retryable) {
        throw new PermanentJobError(error.message);
      }
      throw error;
    }
  });
