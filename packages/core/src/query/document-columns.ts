import { DOCUMENT_STATES, DOCUMENT_STATUSES } from '@liasse/contract/domain';
import type { ScalarFieldDefinition } from '@liasse/contract/registry';
import { type SQL, sql } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { liveType } from './source.ts';

interface DocumentColumn {
  readonly definition: ScalarFieldDefinition;
  // Already of the SQL type its primitive compares as.
  readonly expression: SQL;
}

// The columns of `documents` a query may address, under the name it uses for them. This
// table and the registry are the only origins of what a statement reads.
export const DOCUMENT_COLUMNS = {
  id: { definition: { type: 'identifier' }, expression: sql`${documents.id}` },
  type: { definition: { type: 'identifier' }, expression: sql`${liveType.slug}` },
  title: { definition: { type: 'text' }, expression: sql`${documents.title}` },
  status: {
    definition: { type: 'enum', values: DOCUMENT_STATUSES },
    expression: sql`${documents.status}::text`,
  },
  state: {
    definition: { type: 'enum', values: DOCUMENT_STATES },
    expression: sql`${documents.state}::text`,
  },
  // A day in UTC: the primitive table has dates and no instant.
  ingested_at: {
    definition: { type: 'date' },
    expression: sql`(${documents.ingestedAt} AT TIME ZONE 'UTC')::date`,
  },
  // `real` compares as its shortest decimal form once it is numeric: 0.9 equals 0.9.
  confidence: { definition: { type: 'number' }, expression: sql`${documents.confidence}::numeric` },
  private: { definition: { type: 'boolean' }, expression: sql`${documents.private}` },
} as const satisfies Readonly<Record<string, DocumentColumn>>;
