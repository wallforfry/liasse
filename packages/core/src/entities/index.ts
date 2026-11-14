export type { EntitiesContext, EntitiesReadContext, EntitiesWriteContext } from './context.ts';
export {
  findSensitiveIdentifiers,
  redactSensitiveIdentifiers,
  type SensitiveMatch,
} from './detect-sensitive.ts';
export { type EntityExecutor, withEntityLock } from './entity-lock.ts';
export { type Entity, type EntityTransaction, missingEntityIds } from './entity-store.ts';
export type { EntityMergeError, EntityNotFound, KindMismatch } from './errors.ts';
export {
  type IdentifierView,
  type MentionIdentifier,
  mentionIdentifierSchema,
} from './identifiers.ts';
export {
  DEFAULT_ENTITY_LIST_LIMIT,
  type ListEntitiesOptions,
  listEntitiesOptionsSchema,
  MAX_ENTITY_LIST_LIMIT,
} from './list-options.ts';
export { type EntityList, getEntity, type ListedEntity, listEntities } from './list.ts';
export { type EntityMention, entityMentionSchema, InvalidEntityMentionError } from './mention.ts';
export {
  findMergeCandidates,
  MERGE_REASONS,
  type MergeCandidate,
  type MergeReason,
} from './merge-candidates.ts';
export {
  type ProposedEntityMerge,
  proposeEntityMerge,
  type ProposeEntityMergeInput,
} from './merge-proposals.ts';
export { type EntityPair, mergeEntities } from './merge.ts';
export {
  type EntityMergeProposal,
  type MergeEntityPayload,
  mergeEntityPayloadSchema,
} from './proposal-store.ts';
export type { DocumentCountOptions } from './references.ts';
export {
  type EntityResolution,
  EntityResolutionContendedError,
  resolveEntity,
  type ResolveEntityOptions,
} from './resolve.ts';
export {
  deriveIdentifierKey,
  type IdentifierKey,
  type MaskedIdentifier,
  maskSensitiveIdentifier,
  SENSITIVE_IDENTIFIER_TYPES,
  type SensitiveIdentifierType,
} from './sensitive.ts';
export {
  decideBySimilarity,
  type SimilarityDecision,
  type SimilarityThresholds,
} from './similarity.ts';
