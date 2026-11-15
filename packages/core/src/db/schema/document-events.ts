import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { ID_PREFIXES, newId } from '../../domain/ids.ts';
import { instant, jsonObject } from '../columns.ts';
import { documents } from './documents.ts';
import { documentStatus, processingOutcome, processingStage } from './enums.ts';

/**
 * The processing log of a document: one row per stage that succeeded or attempt that
 * failed, bounded per document by `recordDocumentEvent`. It holds codes and counts only,
 * never a value, a quote or a message read from the document or an error.
 */
export const documentEvents = pgTable(
  'document_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => newId(ID_PREFIXES.documentEvent)),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    occurredAt: instant('occurred_at').notNull().defaultNow(),
    stage: processingStage('stage').notNull(),
    outcome: processingOutcome('outcome').notNull(),
    status: documentStatus('status'),
    attempt: integer('attempt'),
    maxAttempts: integer('max_attempts'),
    errorCode: text('error_code'),
    errorName: text('error_name'),
    retryable: boolean('retryable'),
    httpStatus: integer('http_status'),
    providerCode: text('provider_code'),
    model: text('model'),
    details: jsonObject('details'),
  },
  (table) => [index('document_events_document_idx').on(table.documentId, table.occurredAt)],
);
