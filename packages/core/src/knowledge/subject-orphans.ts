import { and, inArray, notExists, sql } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { subjects } from '../db/schema/knowledge.ts';
import { toSubjectIdentifiersColumn } from './subject-identifiers.ts';
import type { SubjectTransaction } from './subject-store.ts';

/**
 * Blanks those of the given subjects that no live document concerns any more: what is
 * known of a subject was read in documents, and those are gone. A blank subject has no
 * label, alias, identifier or embedding, so it attaches no mention and no reader shows
 * it. The row and its id stay: a pending merge proposal may still name it.
 *
 * Runs under the subject lock, in the transaction that changed `documents.subject_ids`.
 */
export const blankOrphanSubjects = async (
  tx: SubjectTransaction,
  ids: readonly string[],
): Promise<void> => {
  if (ids.length === 0) return;
  const concerning = tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(isLiveDocument, sql`${documents.subjectIds} @> ARRAY[${subjects.id}]::text[]`));
  await tx
    .update(subjects)
    .set({
      canonicalName: '',
      aliases: [],
      identifiers: toSubjectIdentifiersColumn([]),
      embedding: null,
    })
    .where(and(inArray(subjects.id, [...ids]), notExists(concerning)));
};
