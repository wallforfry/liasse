import type { EntityMatchRule } from '@liasse/contract/domain';
import {
  haveConflictingSubjectIdentifiers,
  isAttachingSubjectIdentifier,
  isGlobalSubjectIdentifier,
} from './subject-identifier-rules.ts';
import { type SubjectIdentifier, subjectIdentifierIdentity } from './subject-identifiers.ts';
import { isDistinctiveLabel, subjectLabelKey } from './subject-label.ts';
import type { SubjectMention } from './subject-mention.ts';
import type { Subject } from './subject-store.ts';

export interface ExactSubjectMatch {
  readonly subject: Subject;
  readonly match: Extract<EntityMatchRule, 'identifier' | 'name' | 'alias'>;
}

const carries =
  (identity: string) =>
  ({ identifiers }: Subject): boolean =>
    identifiers.some((identifier) => subjectIdentifierIdentity(identifier) === identity);

// The subject an identifier of the mention designates: the only one that carries it. A
// contract number two subjects carry, or an address two properties share, says nothing,
// and the label decides.
const byIdentifier = (
  subjects: readonly Subject[],
  identifiers: readonly SubjectIdentifier[],
): Subject | undefined =>
  identifiers
    .filter(isAttachingSubjectIdentifier)
    .map(subjectIdentifierIdentity)
    .flatMap((identity) => {
      const carriers = subjects.filter(carries(identity));
      return carriers.length === 1 ? carriers : [];
    })[0];

// A subject that carries another plate, contract number or full address than the mention
// is another subject, whatever its label: a duplicate can be merged by hand, a wrong
// fusion cannot be undone.
export const mayDesignateSubject =
  ({ identifiers }: Pick<SubjectMention, 'identifiers'>) =>
  (subject: Subject): boolean =>
    !haveConflictingSubjectIdentifiers(subject.identifiers, identifiers);

const hasAlias =
  (labelKey: string) =>
  ({ aliases }: Subject): boolean =>
    aliases.some((alias) => subjectLabelKey(alias) === labelKey);

// The two rules that need no model, as for entities: an identifier first, then the
// normalized label against the canonical name and the aliases. Takes the subjects of the
// kind of the mention, oldest first, so the first of several matches wins.
export const matchSubjectExactly = (
  subjects: readonly Subject[],
  mention: SubjectMention,
): ExactSubjectMatch | undefined => {
  const identified = byIdentifier(subjects, mention.identifiers);
  if (identified !== undefined) return { subject: identified, match: 'identifier' };
  if (!isDistinctiveLabel(mention.name)) return undefined;
  const named = subjects.filter(mayDesignateSubject(mention));
  const byName = named.find(
    ({ canonicalName }) => subjectLabelKey(canonicalName) === mention.labelKey,
  );
  if (byName !== undefined) return { subject: byName, match: 'name' };
  const byAlias = named.find(hasAlias(mention.labelKey));
  return byAlias === undefined ? undefined : { subject: byAlias, match: 'alias' };
};

// The identifiers of a mention a subject may take. Never a global identifier that another
// subject carries: copying a plate would make two subjects look like one to every later
// mention, on the word of a single document. And never one that conflicts with what the
// subject has, however the mention was attached.
export const subjectIdentifiersFor = (
  subject: Subject | undefined,
  everySubject: readonly Subject[],
  identifiers: readonly SubjectIdentifier[],
): readonly SubjectIdentifier[] => {
  const others = everySubject.filter(({ id }) => id !== subject?.id);
  return identifiers.filter(
    (identifier) =>
      !haveConflictingSubjectIdentifiers(subject?.identifiers ?? [], [identifier]) &&
      !(
        isGlobalSubjectIdentifier(identifier) &&
        others.some(carries(subjectIdentifierIdentity(identifier)))
      ),
  );
};

// The aliases of a subject once it also goes by these labels: one that normalizes like
// the canonical name or like an alias already there adds nothing.
export const withSubjectAliases = (
  { canonicalName, aliases }: Pick<Subject, 'canonicalName' | 'aliases'>,
  labels: readonly string[],
): readonly string[] =>
  labels.reduce<readonly string[]>((known, label) => {
    const labelKey = subjectLabelKey(label);
    return [canonicalName, ...known].some((other) => subjectLabelKey(other) === labelKey)
      ? known
      : [...known, label];
  }, aliases);
