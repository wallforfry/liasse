import { type DocumentEventList, documentEventSchema } from '@liasse/contract';
import { and, asc, eq } from 'drizzle-orm';
import { documentEvents } from '../db/schema/document-events.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import type { ApiContext } from './context.ts';
import { documentNotFound } from './errors.ts';

type EventRow = typeof documentEvents.$inferSelect;

// Parsed, not asserted: `details` is a JSON column, and a status is never a tombstone.
const toDocumentEvent = ({
  documentId: _,
  occurredAt,
  maxAttempts,
  errorCode,
  errorName,
  ...row
}: EventRow) =>
  documentEventSchema.parse({
    ...row,
    occurred_at: occurredAt.toISOString(),
    max_attempts: maxAttempts,
    error_code: errorCode,
    error_name: errorName,
  });

/**
 * The processing log of a document, oldest first. Rejects with `document_not_found` for
 * an id that is unknown or deleted; a private document is answered, as by `getDocument`.
 */
export const listDocumentEvents = async (
  { db }: Pick<ApiContext, 'db'>,
  id: string,
): Promise<DocumentEventList> => {
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, id), isLiveDocument));
  if (document === undefined) throw documentNotFound();
  const rows = await db
    .select()
    .from(documentEvents)
    .where(eq(documentEvents.documentId, id))
    .orderBy(asc(documentEvents.occurredAt), asc(documentEvents.id));
  return { events: rows.map(toDocumentEvent) };
};
