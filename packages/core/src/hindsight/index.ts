export {
  createHindsightClient,
  type HindsightClient,
  type HindsightClientOptions,
  type HindsightSettings,
} from './client.ts';
export {
  HindsightError,
  type HindsightFailure,
  type HindsightFailureCode,
  type HindsightOperation,
  HindsightSyncBusyError,
  HindsightSyncLockLostError,
  HindsightUrlError,
} from './errors.ts';
export {
  type HindsightForgetSweepDeps,
  type HindsightForgetSweepOptions,
  requeueHindsightForgets,
} from './forget-sweep.ts';
export {
  createHindsightIntegration,
  describeHindsight,
  type HindsightIntegration,
  type HindsightIntegrationDeps,
} from './integration.ts';
export type { RetainTarget, SensitiveDetector } from './memory.ts';
export {
  type HindsightSyncAction,
  type HindsightSyncDeps,
  type HindsightSyncResult,
  syncDocumentToHindsight,
} from './sync-document.ts';
export {
  createHindsightSyncHandler,
  enqueueHindsightSync,
  HINDSIGHT_SYNC_CONCURRENCY,
  type HindsightSyncHandlerDeps,
  hindsightSyncJob,
  type WithheldFacts,
} from './sync-job.ts';
export type { RetainItem } from './wire.ts';
