import type { SubjectKind } from '../domain/enums.ts';
import { redactSensitiveIdentifiers } from '../entities/detect-sensitive.ts';
import type { IdentifierKey } from '../entities/sensitive.ts';
import type { KnowledgeSubject } from './input.ts';
import {
  haveConflictingSubjectIdentifiers,
  mergeSubjectIdentifiers,
  storeSubjectIdentifier,
  type SubjectIdentifier,
} from './subject-identifiers.ts';
import { subjectLabelKey } from './subject-label.ts';

// A candidate subject of a document, ready to be resolved. The clear value of an IBAN or
// a card number does not go further than this.
export interface SubjectMention {
  readonly kind: SubjectKind;
  readonly name: string;
  readonly labelKey: string;
  readonly identifiers: readonly SubjectIdentifier[];
}

const prepare = (
  key: IdentifierKey,
  { kind, name, identifier }: KnowledgeSubject,
): SubjectMention => {
  // An IBAN written in the label would otherwise be stored as a name, embedded and shown
  // to the text model.
  const label = redactSensitiveIdentifiers(name);
  return {
    kind,
    name: label,
    labelKey: subjectLabelKey(label),
    identifiers: storeSubjectIdentifier(key, kind, identifier),
  };
};

const sameSubject = (left: SubjectMention, right: SubjectMention): boolean =>
  left.kind === right.kind &&
  left.labelKey === right.labelKey &&
  !haveConflictingSubjectIdentifiers(left.identifiers, right.identifiers);

// The candidates of one document, each kind and label once: a model that lists a subject
// twice names one subject, with the identifiers of both lines. Two lines of one label
// with two plates stay two subjects: a contract may cover two cars.
export const prepareSubjectMentions = (
  key: IdentifierKey,
  candidates: readonly KnowledgeSubject[],
): readonly SubjectMention[] =>
  candidates
    .map((candidate) => prepare(key, candidate))
    .reduce<readonly SubjectMention[]>((mentions, mention) => {
      const known = mentions.find((other) => sameSubject(other, mention));
      return known === undefined
        ? [...mentions, mention]
        : mentions.map((other) =>
            other === known
              ? {
                  ...other,
                  identifiers: mergeSubjectIdentifiers(other.identifiers, mention.identifiers),
                }
              : other,
          );
    }, []);
