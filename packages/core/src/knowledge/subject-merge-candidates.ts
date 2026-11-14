import type { KnowledgeReadContext } from './context.ts';
import {
  haveConflictingSubjectIdentifiers,
  isGlobalSubjectIdentifier,
  sharedGlobalSubjectIdentifiers,
  subjectIdentifierIdentity,
} from './subject-identifiers.ts';
import { isDistinctiveLabel, subjectLabelKey } from './subject-label.ts';
import { loadSubjects, type Subject } from './subject-store.ts';

export const SUBJECT_MERGE_REASONS = ['shared_identifier', 'same_name'] as const;
export type SubjectMergeReason = (typeof SUBJECT_MERGE_REASONS)[number];

export interface SubjectMergeCandidate {
  // The younger subject, to merge into the older one.
  readonly sourceId: string;
  readonly targetId: string;
  readonly reason: SubjectMergeReason;
}

const labelKeysOf = ({ canonicalName, aliases }: Subject): readonly string[] =>
  [canonicalName, ...aliases].filter(isDistinctiveLabel).map(subjectLabelKey);

export const sharesSubjectLabel = (left: Subject, right: Subject): boolean => {
  const keys = new Set(labelKeysOf(right));
  return labelKeysOf(left).some((key) => keys.has(key));
};

// What makes two subjects of one kind candidates: a global identifier, or a label. A
// contract number is not one, two issuers may give the same, and neither is an address.
const relationKeysOf = (subject: Subject): readonly string[] => [
  ...subject.identifiers
    .filter(isGlobalSubjectIdentifier)
    .map((identifier) => `${subject.kind}|identifier|${subjectIdentifierIdentity(identifier)}`),
  ...labelKeysOf(subject).map((key) => `${subject.kind}|name|${key}`),
];

const sharesIdentifier = (left: Subject, right: Subject): boolean =>
  sharedGlobalSubjectIdentifiers(left.identifiers, right.identifiers).length > 0;

// Two subjects of one label with two plates, or two contract numbers, are two subjects:
// only an identifier they share makes them candidates.
const mayBeOne = (left: Subject, right: Subject): boolean =>
  sharesIdentifier(left, right) ||
  !haveConflictingSubjectIdentifiers(left.identifiers, right.identifiers);

// Each subject is paired with the oldest one it is related to, and only with that one, so
// no pair is proposed twice. Takes the subjects oldest first.
export const subjectMergeCandidatesAmong = (
  subjects: readonly Subject[],
): readonly SubjectMergeCandidate[] => {
  const relatedByKey = new Map<string, readonly Subject[]>();
  return subjects.flatMap((subject) => {
    const keys = relationKeysOf(subject);
    const [target] = keys
      .flatMap((key) => relatedByKey.get(key) ?? [])
      .filter((other) => mayBeOne(subject, other))
      .toSorted((left, right) => (left.id < right.id ? -1 : 1));
    keys.forEach((key) => relatedByKey.set(key, [...(relatedByKey.get(key) ?? []), subject]));
    return target === undefined
      ? []
      : [
          {
            sourceId: subject.id,
            targetId: target.id,
            reason: sharesIdentifier(subject, target) ? 'shared_identifier' : 'same_name',
          } as const,
        ];
  });
};

// The pairs of subjects that look like one: same kind, and a shared global identifier or
// an equal normalized label without identifiers that tell them apart. Deterministic: the
// same subjects give the same pairs.
export const findSubjectMergeCandidates = async ({
  db,
}: KnowledgeReadContext): Promise<readonly SubjectMergeCandidate[]> =>
  subjectMergeCandidatesAmong(await loadSubjects(db));
