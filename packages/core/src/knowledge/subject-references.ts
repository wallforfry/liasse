import { arrayContains } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { replacedInArray, rewritePendingMerges } from '../entities/references.ts';
import type { SubjectTransaction } from './subject-store.ts';

// Every place a subject id lives outside `subjects`. None of them has a foreign key
// (array and JSON columns), so this module is what keeps them true: a new place that
// holds a subject id is added here, and the scan in `subject-merge.test.ts` fails until
// it is.
//
// - `documents.subject_ids`, tombstones included: theirs is empty.
// - `facts.subject_ids`.
// - `type_changes.payload` of a `merge_subject` proposal, pending or rejected.

const rewriteDocuments = async (
  tx: SubjectTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await tx
    .update(documents)
    .set({ subjectIds: replacedInArray(documents.subjectIds, sourceId, targetId) })
    .where(arrayContains(documents.subjectIds, [sourceId]));
};

const rewriteFacts = async (
  tx: SubjectTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await tx
    .update(facts)
    .set({ subjectIds: replacedInArray(facts.subjectIds, sourceId, targetId) })
    .where(arrayContains(facts.subjectIds, [sourceId]));
};

// Points every reference to the source at the target. Both ids must be well-formed
// subject ids: the caller has read both subjects, under the subject lock.
export const rewriteSubjectReferences = async (
  tx: SubjectTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await rewriteDocuments(tx, sourceId, targetId);
  await rewriteFacts(tx, sourceId, targetId);
  await rewritePendingMerges(tx, 'merge_subject', sourceId, targetId);
};
