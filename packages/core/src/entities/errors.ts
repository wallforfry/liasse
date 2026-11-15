import type { EntityKind } from '@liasse/contract/domain';

interface Failure<Code extends string> {
  readonly code: Code;
  // Complete on its own: it is shown as is to the agent that made the request.
  readonly message: string;
}

export interface EntityNotFound extends Failure<'entity_not_found'> {
  readonly id: string;
}

export interface KindMismatch extends Failure<'kind_mismatch'> {
  readonly sourceKind: EntityKind;
  readonly targetKind: EntityKind;
}

export type EntityMergeError = Failure<'self_merge'> | EntityNotFound | KindMismatch;

export const selfMerge = (id: string): Failure<'self_merge'> => ({
  code: 'self_merge',
  message: `The entity "${id}" cannot be merged into itself.`,
});

export const entityNotFound = (id: string): EntityNotFound => ({
  code: 'entity_not_found',
  message: `No entity has the id "${id}".`,
  id,
});

export const kindMismatch = (sourceKind: EntityKind, targetKind: EntityKind): KindMismatch => ({
  code: 'kind_mismatch',
  message: `An entity of kind "${sourceKind}" cannot be merged into one of kind "${targetKind}".`,
  sourceKind,
  targetKind,
});
