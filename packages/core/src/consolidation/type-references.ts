import { arrayContains, sql } from 'drizzle-orm';
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

/**
 * The types a person rejected for a document stay rejected under the target of a merge:
 * the source becomes the target in every list, which then holds the target once.
 */
export const rewriteRejectedTypes = async (
  tx: ChangeTransaction,
  sourceId: string,
  targetId: string,
): Promise<void> => {
  // A tombstone holds none: its list is blanked with the rest of its content.
  const holdsSource = arrayContains(documents.rejectedTypeIds, [sourceId]);
  await lockDocumentRows(tx, holdsSource);
  await tx
    .update(documents)
    .set({
      rejectedTypeIds: sql`CASE
        WHEN ${targetId}::text = ANY(${documents.rejectedTypeIds})
          THEN array_remove(${documents.rejectedTypeIds}, ${sourceId}::text)
        ELSE array_replace(${documents.rejectedTypeIds}, ${sourceId}::text, ${targetId}::text)
      END`,
    })
    .where(holdsSource);
};
