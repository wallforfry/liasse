import { recordMergeProposal, type RecordedProposal } from '../entities/proposal-store.ts';
import { ok, type Result } from '../registry/result.ts';
import type { KnowledgeWriteContext } from './context.ts';
import type { SubjectMergeError } from './subject-errors.ts';
import { sharedGlobalSubjectIdentifiers } from './subject-identifier-rules.ts';
import { type SubjectIdentifier, viewSubjectIdentifier } from './subject-identifiers.ts';
import { withSubjectLock } from './subject-lock.ts';
import { findMergeableSubjects, type SubjectPair } from './subject-merge.ts';
import { sharesSubjectLabel } from './subject-merge-candidates.ts';
import type { Subject } from './subject-store.ts';

// `auto` is true when the two subjects share a plate, a vehicle identification number,
// an IBAN or a card number: such a merge needs no approval. A shared contract number, a
// shared address or an equal label is not enough. Whether it is applied without one is
// the decision of the consolidation policy.
export type ProposedSubjectMerge = RecordedProposal;

// An IBAN or a card number is named by its last characters only.
const describeIdentifier = (identifier: SubjectIdentifier): string => {
  const { type, value } = viewSubjectIdentifier(identifier);
  return `${type.replaceAll('_', ' ')} ${value}`;
};

const describeRelation = (
  source: Subject,
  target: Subject,
  shared: readonly SubjectIdentifier[],
): string => {
  const [identifier] = shared;
  const pair = `"${source.canonicalName}" and "${target.canonicalName}"`;
  if (identifier !== undefined) return `${pair} carry the same ${describeIdentifier(identifier)}.`;
  return sharesSubjectLabel(source, target)
    ? `${pair} go by the same label once normalized, and share no global identifier.`
    : `${pair} share no global identifier and no normalized label.`;
};

export interface ProposeSubjectMergeInput extends SubjectPair {
  // Why the two are one subject, when the caller knows more than the identifiers say.
  readonly rationale?: string | undefined;
}

// Records the proposal to merge the source into the target, as a `merge_subject` change.
// Refuses what `mergeSubjects` would refuse, and never applies anything. A pair is
// proposed once, in either direction, whatever became of its proposal.
export const proposeSubjectMerge = (
  { db }: KnowledgeWriteContext,
  { rationale, ...pair }: ProposeSubjectMergeInput,
): Promise<Result<ProposedSubjectMerge, SubjectMergeError>> =>
  withSubjectLock(db, async (tx) => {
    const found = await findMergeableSubjects(tx, pair);
    if (!found.ok) return found;
    const { source, target } = found.value;
    const shared = sharedGlobalSubjectIdentifiers(source.identifiers, target.identifiers);
    return ok(
      await recordMergeProposal(tx, 'merge_subject', {
        sourceId: source.id,
        targetId: target.id,
        rationale: rationale ?? describeRelation(source, target, shared),
        auto: shared.length > 0,
      }),
    );
  });
