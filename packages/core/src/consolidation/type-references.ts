import { arrayContains, eq, sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { lockDocumentRows } from '../ingest/live-write.ts';
import type { ChangeTransaction } from './change-store.ts';

// Every place a type id lives without a foreign key to `doc_types`, and what a merge
// does with it:
//
// - `documents.rejected_type_ids`: rewritten to the target, once.
// - `type_changes.payload`: left as it is; a change that names a merged type is refused
//   when it is applied, and a decided one is history.
// - `jobs.payload` of `reclassify_document`: left as it is; the merge moves the document
//   off the rejected type, and the job leaves a document whose type changed alone.

// A tombstone holds none: its list is blanked with the rest of its content.
const rejects = (typeId: string) => arrayContains(documents.rejectedTypeIds, [typeId]);

/**
 * Locks, in one pass in the order of their ids, every document a merge of the type
 * rewrites: those of the type and those that rejected it. Two passes would take the rows
 * in two orders, against a writer of a link that holds a pair in one.
 */
export const lockReferencingDocuments = (tx: ChangeTransaction, typeId: string): Promise<void> =>
  lockDocumentRows(tx, sql`(${eq(documents.typeId, typeId)} OR ${rejects(typeId)})`);

/**
 * The types a person rejected for a document stay rejected under the target of a merge:
 * the source becomes the target in every list, which then holds the target once. The rows
 * are those `lockReferencingDocuments` locked.
 */
export const rewriteRejectedTypes = async (
  tx: ChangeTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  await tx
    .update(documents)
    .set({
      rejectedTypeIds: sql`CASE
        WHEN ${targetId}::text = ANY(${documents.rejectedTypeIds})
          THEN array_remove(${documents.rejectedTypeIds}, ${sourceId}::text)
        ELSE array_replace(${documents.rejectedTypeIds}, ${sourceId}::text, ${targetId}::text)
      END`,
    })
    .where(rejects(sourceId));
};
