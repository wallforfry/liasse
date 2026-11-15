import { type DocumentStatus, IN_PROGRESS_STATUSES } from '@liasse/contract/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import type { Transaction } from './existing-document.ts';
import { writeIfLive } from './live-write.ts';

const documentPayloadSchema = z.object({ documentId: z.string().min(1) });

/** The document a job was about, when its stored payload names one. */
export const documentOfPayload = (payload: unknown): string | undefined =>
  documentPayloadSchema.safeParse(payload).data?.documentId;

/**
 * Sets `status` and `error` on a document that is live and in one of `from`; anything
 * else is left alone. Given a transaction, it writes in it.
 */
export const flagDocument = async (
  db: Database | Transaction,
  documentId: string,
  from: readonly DocumentStatus[],
  status: DocumentStatus,
  error: string,
): Promise<void> => {
  await writeIfLive(db, documentId, (tx) =>
    tx
      .update(documents)
      .set({ status, error })
      .where(and(eq(documents.id, documentId), inArray(documents.status, [...from]))),
  );
};

/** A document still on its way through the pipeline ends `failed` with `code`. */
export const failDocumentInProgress = (
  db: Database | Transaction,
  documentId: string,
  code: string,
): Promise<void> => flagDocument(db, documentId, IN_PROGRESS_STATUSES, 'failed', code);
