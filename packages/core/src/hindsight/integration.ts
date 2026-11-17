import type { Database } from '../db/client.ts';
import type { JobExecutor } from '../jobs/enqueue.ts';
import type { RegisteredHandler } from '../jobs/handlers.ts';
import type { HindsightSettings, ResolvedSettings } from '../settings/resolve.ts';
import { createHindsightClient, type HindsightClientOptions } from './client.ts';
import { type HindsightForgetSweepOptions, requeueHindsightForgets } from './forget-sweep.ts';
import type { SensitiveDetector } from './memory.ts';
import {
  createHindsightSyncHandler,
  enqueueHindsightSync,
  HINDSIGHT_SYNC_CONCURRENCY,
  hindsightSyncJob,
  type WithheldFacts,
} from './sync-job.ts';

export interface HindsightIntegrationDeps {
  readonly db: Database;
  /**
   * Required, without a default: facts are free text written by a model, and this
   * detector is the only guard between them and Hindsight. The server binds the one of
   * `@liasse/core/entities`, which this module does not import:
   * `isSensitive: (text) => findSensitiveIdentifiers(text).length > 0`.
   */
  readonly isSensitive: SensitiveDetector;
  readonly onFactsWithheld?: (withheld: WithheldFacts) => void;
  readonly client?: HindsightClientOptions;
}

export interface HindsightIntegration {
  readonly enabled: boolean;
  /**
   * To call in the transaction of every change Hindsight must follow: a document
   * indexed, extracted again, flagged private or public, or deleted. Queues nothing
   * when the integration is disabled.
   */
  readonly enqueueSync: (executor: JobExecutor, documentId: string) => Promise<void>;
  /** The handlers to register with the workers: none when the integration is disabled. */
  readonly handlers: readonly RegisteredHandler[];
  /** To spread into the `perKindConcurrency` of the workers. */
  readonly perKindConcurrency: Readonly<Record<string, number>>;
  /**
   * To call at startup: queues again the forgets that are still owed. Resolves to their
   * number, 0 when the integration is disabled.
   */
  readonly requeueForgets: (options?: HindsightForgetSweepOptions) => Promise<number>;
}

const DISABLED: HindsightIntegration = Object.freeze({
  enabled: false,
  enqueueSync: () => Promise.resolve(),
  handlers: Object.freeze([]),
  perKindConcurrency: Object.freeze({}),
  requeueForgets: () => Promise.resolve(0),
});

/**
 * The whole integration, from the Hindsight settings. Without a URL they are
 * undefined: no client exists, no job is queued and no handler is registered, so no
 * request to Hindsight can be made.
 */
export const createHindsightIntegration = (
  settings: HindsightSettings | undefined,
  { db, client, isSensitive, onFactsWithheld }: HindsightIntegrationDeps,
): HindsightIntegration => {
  if (settings === undefined) return DISABLED;
  const handler = createHindsightSyncHandler({
    db,
    client: createHindsightClient(settings, client),
    target: { url: settings.url, bank: settings.bank },
    isSensitive,
    ...(onFactsWithheld === undefined ? {} : { onFactsWithheld }),
  });
  return {
    enabled: true,
    enqueueSync: async (executor, documentId) => {
      await enqueueHindsightSync(executor, documentId);
    },
    handlers: [handler],
    perKindConcurrency: { [hindsightSyncJob.name]: HINDSIGHT_SYNC_CONCURRENCY },
    requeueForgets: (options) => requeueHindsightForgets({ db }, options),
  };
};

/** The line of the startup privacy summary, undefined when the integration is disabled. */
export const describeHindsight = ({
  hindsight,
}: Pick<ResolvedSettings, 'hindsight'>): string | undefined =>
  hindsight === undefined
    ? undefined
    : `Warning: facts extracted from documents not flagged private are sent to Hindsight at ${new URL(hindsight.url).host} (bank ${hindsight.bank}). ` +
      'Clear the URL of Hindsight in the settings to keep them local.';
