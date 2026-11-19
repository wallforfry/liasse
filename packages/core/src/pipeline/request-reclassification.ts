import { SETTLED_STATUSES } from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { writeIfLive } from '../ingest/live-write.ts';
import { cleanHint } from '../ingest/untrusted-text.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { loadDocument, type PipelineDocument } from './document.ts';
import { reclassifyDocumentJob } from './jobs.ts';
import { hasPendingWrite } from './pending-write.ts';

export interface ReclassificationRequest {
  readonly hint?: string | undefined;
  readonly newType?: boolean | undefined;
  /**
   * What the document must still be, read under its row lock, for a request that chose it
   * from a list read before; a document that no longer is counts as not settled.
   */
  readonly onlyIf?: (document: PipelineDocument) => boolean;
}

export type ReclassificationOutcome = 'queued' | 'not_settled' | 'not_found';

const withRejected = (rejected: readonly string[], typeId: string | null): readonly string[] =>
  typeId === null || rejected.includes(typeId) ? rejected : [...rejected, typeId];

/**
 * A person asking for the type of a settled document to be decided again, the type it
 * has now being the one rejected. A job of `hasPendingWrite` is about to change that type,
 * and each enqueues under the row lock of the document, which this holds too: two
 * requests, or a request and a correction, cannot both see the document free. The hint
 * goes on the document, replacing the one of an earlier request, and the job reads it
 * there. The rejected type joins those of earlier requests on the document, which no
 * reclassification chooses until a person sets the type by hand.
 */
export const requestReclassification = async (
  db: Database,
  documentId: string,
  { hint, newType, onlyIf = () => true }: ReclassificationRequest,
): Promise<ReclassificationOutcome> => {
  const outcome = await writeIfLive(
    db,
    documentId,
    async (tx): Promise<ReclassificationOutcome> => {
      const document = await loadDocument(tx, documentId);
      if (document === undefined) return 'not_found';
      if (
        !SETTLED_STATUSES.includes(document.status) ||
        !onlyIf(document) ||
        (await hasPendingWrite(tx, documentId))
      ) {
        return 'not_settled';
      }
      await tx
        .update(documents)
        .set({
          reclassificationHint: cleanHint(hint) ?? null,
          rejectedTypeIds: withRejected(document.rejectedTypeIds, document.typeId),
        })
        .where(eq(documents.id, documentId));
      await enqueue(tx, {
        kind: reclassifyDocumentJob,
        payload: { documentId, rejectedTypeId: document.typeId, newType: newType ?? false },
      });
      return 'queued';
    },
  );
  return outcome.written ? outcome.result : 'not_found';
};
