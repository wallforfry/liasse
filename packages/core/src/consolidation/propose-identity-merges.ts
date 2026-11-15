import type { Result } from '@liasse/contract/registry';
import type { Database } from '../db/client.ts';
import { findMergeCandidates } from '../entities/merge-candidates.ts';
import { proposeEntityMerge } from '../entities/merge-proposals.ts';
import type { RecordedProposal } from '../entities/proposal-store.ts';
import { findSubjectMergeCandidates } from '../knowledge/subject-merge-candidates.ts';
import { proposeSubjectMerge } from '../knowledge/subject-merge-proposals.ts';

const isNew = (result: Result<RecordedProposal, unknown>): boolean =>
  result.ok && result.value.created;

/**
 * Entities and subjects that look like one: each pair is recorded once as a
 * `merge_entity` or `merge_subject` change, with the rule of its kind for `auto` (a shared
 * strong identifier). Answers with the number of proposals this run created.
 */
export const proposeIdentityMerges = async (db: Database): Promise<number> => {
  let created = 0;
  for (const pair of await findMergeCandidates({ db })) {
    if (isNew(await proposeEntityMerge({ db }, pair))) created += 1;
  }
  for (const pair of await findSubjectMergeCandidates({ db })) {
    if (isNew(await proposeSubjectMerge({ db }, pair))) created += 1;
  }
  return created;
};
