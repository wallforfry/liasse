import {
  type DocumentStatus,
  IN_PROGRESS_STATUSES,
  type ProcessingOutcome,
  type ProcessingStage,
} from '@liasse/contract/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { pendingStageOf } from '../processing-log/stage.ts';
import { type DocumentEventInput, recordDocumentEvent } from '../processing-log/record.ts';
import type { Transaction } from './existing-document.ts';
import { writeIfLive } from './live-write.ts';

const documentPayloadSchema = z.object({ documentId: z.string().min(1) });

/** The document a job was about, when its stored payload names one. */
export const documentOfPayload = (payload: unknown): string | undefined =>
  documentPayloadSchema.safeParse(payload).data?.documentId;

/** What the log keeps of the attempt that failed, besides the code. */
export type FailureTrace = Omit<DocumentEventInput, 'stage' | 'outcome' | 'status'> & {
  /** The stage the document was waiting on when left out. */
  readonly stage?: ProcessingStage;
};

const readProgress = async (tx: Transaction, documentId: string) => {
  const [row] = await tx
    .select({ status: documents.status, confidence: documents.confidence })
    .from(documents)
    .where(eq(documents.id, documentId));
  return row;
};

/**
 * Sets `status` and `error` on a document that is live and in one of `from`; anything
 * else is left alone. Given a `trace`, it logs the failure in the same transaction.
 * Given a transaction, it writes in it. Resolves to whether it flagged the document.
 */
export const flagDocument = async (
  db: Database | Transaction,
  documentId: string,
  from: readonly DocumentStatus[],
  status: DocumentStatus,
  error: string,
  trace?: FailureTrace,
): Promise<boolean> => {
  const outcome = await writeIfLive(db, documentId, async (tx) => {
    const current = await readProgress(tx, documentId);
    if (current === undefined || !from.includes(current.status)) return false;
    await tx.update(documents).set({ status, error }).where(eq(documents.id, documentId));
    const stage = trace?.stage ?? pendingStageOf(current);
    if (trace === undefined || stage === undefined) return true;
    await recordDocumentEvent(tx, documentId, {
      errorCode: error,
      ...trace,
      stage,
      outcome: 'failed',
      status,
    });
    return true;
  });
  return outcome.written && outcome.result;
};

/** A document still on its way through the pipeline ends `failed` with `code`. */
export const failDocumentInProgress = (
  db: Database | Transaction,
  documentId: string,
  code: string,
  trace: FailureTrace = {},
): Promise<boolean> => flagDocument(db, documentId, IN_PROGRESS_STATUSES, 'failed', code, trace);

/**
 * Logs an attempt that failed without changing the document: one whose job runs again,
 * or the last one of a job whose failure leaves its document as it is. Nothing is logged
 * for a document that is gone, failed, or not waiting on any stage.
 */
export const logFailedAttempt = async (
  db: Database | Transaction,
  documentId: string,
  outcome: Exclude<ProcessingOutcome, 'succeeded'>,
  { stage, ...trace }: FailureTrace,
): Promise<void> => {
  await writeIfLive(db, documentId, async (tx) => {
    const current = await readProgress(tx, documentId);
    if (current === undefined || current.status === 'failed') return;
    const failedStage = stage ?? pendingStageOf(current);
    if (failedStage === undefined) return;
    await recordDocumentEvent(tx, documentId, {
      ...trace,
      stage: failedStage,
      outcome,
      status: current.status,
    });
  });
};
