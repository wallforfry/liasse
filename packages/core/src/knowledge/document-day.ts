import { sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';

const DOCUMENT_DATE = sql`${documents.core} ->> 'document_date'`;

// `core` is validated when it is written, but a comparison must not rest on it: only a
// value of the form of an ISO date is read as one. ISO dates compare like text, and a text
// comparison cannot raise on a stored value the way a cast to date would.
const IS_DATE = sql`${DOCUMENT_DATE} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;

// The date a document states for itself, null when it states none.
export const statedDocumentDate = sql<
  string | null
>`(CASE WHEN ${IS_DATE} THEN ${DOCUMENT_DATE} END)`;

// The day a document is placed at when its date is needed whatever it states: its own
// date, or the UTC day it was ingested.
export const documentDay = sql<string>`COALESCE(
  ${statedDocumentDate}, to_char(${documents.ingestedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')
)`;
