import { type DocumentEventDetails, documentEventDetailsSchema } from '@liasse/contract';
import type { DocumentStatus, ProcessingOutcome, ProcessingStage } from '@liasse/contract/domain';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { documentEvents } from '../db/schema/document-events.ts';
import type { Transaction } from '../ingest/existing-document.ts';

/** The most recent events kept per document; older ones are deleted as new ones come. */
export const MAX_DOCUMENT_EVENTS = 100;

export interface DocumentEventInput {
  readonly stage: ProcessingStage;
  readonly outcome: ProcessingOutcome;
  readonly status?: DocumentStatus;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly errorCode?: string;
  readonly errorName?: string;
  readonly retryable?: boolean;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly model?: string;
  readonly details?: DocumentEventDetails;
}

/**
 * Adds an event to the log of a document, in the transaction of the change it records,
 * and drops what falls beyond `MAX_DOCUMENT_EVENTS`. The caller holds the row of the
 * document (`writeIfLive`), so a deletion never leaves an event behind its tombstone.
 */
export const recordDocumentEvent = async (
  tx: Transaction,
  documentId: string,
  { details = {}, ...event }: DocumentEventInput,
): Promise<void> => {
  await tx
    .insert(documentEvents)
    .values({ ...event, documentId, details: documentEventDetailsSchema.parse(details) });
  const kept = tx
    .select({ id: documentEvents.id })
    .from(documentEvents)
    .where(eq(documentEvents.documentId, documentId))
    .orderBy(desc(documentEvents.occurredAt), desc(documentEvents.id))
    .limit(MAX_DOCUMENT_EVENTS);
  await tx
    .delete(documentEvents)
    .where(and(eq(documentEvents.documentId, documentId), notInArray(documentEvents.id, kept)));
};
