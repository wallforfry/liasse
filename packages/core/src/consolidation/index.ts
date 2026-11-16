export {
  applyByPolicy,
  type DecideResult,
  decideChange,
  type Decision,
  type DecisionOutcome,
  type PolicyResult,
} from './apply-change.ts';
export type { ConsolidationContext, ConsolidationReadContext } from './context.ts';
export { applyChange, listChanges, requestConsolidationRun } from './features.ts';
export { CONSOLIDATION_CONCURRENCY, createConsolidationHandlers } from './handlers.ts';
export {
  type ConsolidationChange,
  type MergePayload,
  mergePayloadSchema,
  type PromoteFieldPayload,
  promoteFieldPayloadSchema,
  type RemoveFieldPayload,
  removeFieldPayloadSchema,
  type StabilizePayload,
  stabilizePayloadSchema,
} from './payloads.ts';
export { appliesAutomatically } from './policy.ts';
export { type ConsolidationReport, runConsolidation } from './run.ts';
export {
  CONSOLIDATION_TRIGGERS,
  consolidateJob,
  type ConsolidationTrigger,
  nextNightlyRun,
  queueBatchRunIfDue,
  queueManualRun,
  scheduleNightlyRun,
} from './schedule.ts';
