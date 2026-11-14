import type { SubjectKind } from '../domain/enums.ts';

interface Failure<Code extends string> {
  readonly code: Code;
  // Complete on its own: it is shown as is to the agent that made the request.
  readonly message: string;
}

export interface SubjectNotFound extends Failure<'subject_not_found'> {
  readonly id: string;
}

export interface SubjectKindMismatch extends Failure<'kind_mismatch'> {
  readonly sourceKind: SubjectKind;
  readonly targetKind: SubjectKind;
}

export type SubjectMergeError = Failure<'self_merge'> | SubjectNotFound | SubjectKindMismatch;

export const selfSubjectMerge = (id: string): Failure<'self_merge'> => ({
  code: 'self_merge',
  message: `The subject "${id}" cannot be merged into itself.`,
});

export const subjectNotFound = (id: string): SubjectNotFound => ({
  code: 'subject_not_found',
  message: `No subject has the id "${id}".`,
  id,
});

export const subjectKindMismatch = (
  sourceKind: SubjectKind,
  targetKind: SubjectKind,
): SubjectKindMismatch => ({
  code: 'kind_mismatch',
  message: `A subject of kind "${sourceKind}" cannot be merged into one of kind "${targetKind}".`,
  sourceKind,
  targetKind,
});
