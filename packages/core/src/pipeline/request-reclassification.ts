import { and, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { jobs } from '../db/schema/jobs.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { writeIfLive } from '../ingest/live-write.ts';
import { processDocumentJob } from '../ingest/process-document-job.ts';
import { cleanHint } from '../ingest/untrusted-text.ts';
import { enqueue } from '../jobs/enqueue.ts';
import { loadDocument, SETTLED_STATUSES } from './document.ts';
import { reclassifyDocumentJob, reextractDocumentJob } from './jobs.ts';

export interface ReclassificationRequest {
  readonly hint?: string | undefined;
  readonly newType?: boolean | undefined;
}

export type ReclassificationOutcome = 'queued' | 'not_settled' | 'not_found';

// The jobs that write the type or the fields of a document once it is settled: another
// reclassification would reject a type that one of them is about to change.
const WRITING_KINDS = [processDocumentJob, reextractDocumentJob, reclassifyDocumentJob].map(
  ({ name }) => name,
);

const hasPendingWrite = async (tx: Transaction, documentId: string): Promise<boolean> => {
  const [pending] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        inArray(jobs.kind, WRITING_KINDS),
        inArray(jobs.status, ['queued', 'running']),
        sql`${jobs.payload}->>'documentId' = ${documentId}`,
      ),
    )
    .limit(1);
  return pending !== undefined;
};

/**
 * A person asking for the type of a settled document to be decided again, the type it
 * has now being the one rejected. Each job above enqueues under the row lock of the
 * document, which this holds too: two requests, or a request and a correction, cannot
 * both see the document free.
 */
export const requestReclassification = async (
  db: Database,
  documentId: string,
  { hint, newType }: ReclassificationRequest,
): Promise<ReclassificationOutcome> => {
  const outcome = await writeIfLive(
    db,
    documentId,
    async (tx): Promise<ReclassificationOutcome> => {
      const document = await loadDocument(tx, documentId);
      if (document === undefined) return 'not_found';
      if (!SETTLED_STATUSES.includes(document.status) || (await hasPendingWrite(tx, documentId))) {
        return 'not_settled';
      }
      await enqueue(tx, {
        kind: reclassifyDocumentJob,
        payload: {
          documentId,
          rejectedTypeId: document.typeId,
          hint: cleanHint(hint) ?? null,
          newType: newType ?? false,
        },
      });
      return 'queued';
    },
  );
  return outcome.written ? outcome.result : 'not_found';
};
