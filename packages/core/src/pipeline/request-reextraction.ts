import { SETTLED_STATUSES } from '@liasse/contract/domain';
import type { Database } from '../db/client.ts';
import { writeIfLive } from '../ingest/live-write.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { loadDocument } from './document.ts';
import { reextractDocumentJob } from './jobs.ts';
import { hasPendingWrite } from './pending-write.ts';

export type ReextractionOutcome = 'queued' | 'not_settled' | 'not_found';

/**
 * A person asking for the values of a settled document to be extracted again, for the
 * type it has. The rules are those of `requestReclassification`, under the same row lock:
 * a document on its way, failed, or with a job of `hasPendingWrite` queued or running is
 * refused. The re-extraction keeps what was corrected by hand, as every extraction does.
 */
export const requestReextraction = async (
  db: Database,
  documentId: string,
): Promise<ReextractionOutcome> => {
  const outcome = await writeIfLive(db, documentId, async (tx): Promise<ReextractionOutcome> => {
    const document = await loadDocument(tx, documentId);
    if (document === undefined) return 'not_found';
    if (!SETTLED_STATUSES.includes(document.status) || (await hasPendingWrite(tx, documentId))) {
      return 'not_settled';
    }
    await enqueue(tx, { kind: reextractDocumentJob, payload: { documentId } });
    return 'queued';
  });
  return outcome.written ? outcome.result : 'not_found';
};
