import { and, asc, eq } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { reextractDocumentJob } from '../pipeline/jobs.ts';
import { SETTLED_STATUSES } from '../pipeline/document.ts';
import type { ChangeTransaction } from './change-store.ts';
import { type Rehoming, rehomeValues } from './rehome-values.ts';

export interface DocumentMove {
  /** The type whose documents the change concerns. */
  readonly fromTypeId: string;
  /** The type they belong to afterwards: another one for a merge. */
  readonly toTypeId: string;
  readonly rehoming: Rehoming;
}

/**
 * Moves the values of every live document of a type to the schema a change gives it, and
 * the documents to the target of a merge, then queues a re-extraction of each settled one
 * from its stored text. Runs in the transaction of the change, before its registry write:
 * the rows of the documents are taken before the row of the type, the order an
 * extraction takes them in. Answers with the number of re-extractions queued.
 *
 * A document moved to another type has no `schema_version` until it is extracted again;
 * its confidence stays, since nobody vouched for or against its values. A document still
 * on its way is left to `process_document`, which extracts it for its type as it is then.
 */
export const moveDocuments = async (
  tx: ChangeTransaction,
  { fromTypeId, toTypeId, rehoming }: DocumentMove,
): Promise<number> => {
  const rows = await tx
    .select({
      id: documents.id,
      status: documents.status,
      fields: documents.fields,
      extra: documents.extra,
      provenance: documents.provenance,
      manualFields: documents.manualFields,
    })
    .from(documents)
    .where(and(eq(documents.typeId, fromTypeId), isLiveDocument))
    .orderBy(asc(documents.id))
    .for('update');
  const retyped = fromTypeId !== toTypeId;
  for (const row of rows) {
    await tx
      .update(documents)
      .set({
        ...rehomeValues(row, rehoming),
        ...(retyped ? { typeId: toTypeId, schemaVersion: null } : {}),
      })
      .where(eq(documents.id, row.id));
  }
  const settled = rows.filter(({ status }) => SETTLED_STATUSES.includes(status));
  for (const { id } of settled) {
    await enqueue(tx, { kind: reextractDocumentJob, payload: { documentId: id } });
  }
  return settled.length;
};
