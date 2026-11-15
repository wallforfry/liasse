import { type DocumentSummary, documentSummarySchema } from '@liasse/contract';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';

export const SUMMARY_COLUMNS = {
  id: documents.id,
  status: documents.status,
  state: documents.state,
  type: docTypes.slug,
  title: documents.title,
  summary: documents.summary,
  mime: documents.mime,
  originalName: documents.originalName,
  source: documents.source,
  private: documents.private,
  confidence: documents.confidence,
  error: documents.error,
  core: documents.core,
  ingestedAt: documents.ingestedAt,
  updatedAt: documents.updatedAt,
} as const;

interface SummaryRow {
  readonly id: string;
  readonly status: string;
  readonly state: string;
  readonly type: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly mime: string;
  readonly originalName: string;
  readonly source: string;
  readonly private: boolean;
  readonly confidence: number | null;
  readonly error: string | null;
  readonly core: unknown;
  readonly ingestedAt: Date;
  readonly updatedAt: Date;
}

// Parsed, not asserted: a row is read under the tombstone rule, and this is what holds
// a caller to it should a query forget the rule.
export const toDocumentSummary = ({
  originalName,
  ingestedAt,
  updatedAt,
  ...row
}: SummaryRow): DocumentSummary =>
  documentSummarySchema.parse({
    ...row,
    original_name: originalName,
    ingested_at: ingestedAt.toISOString(),
    updated_at: updatedAt.toISOString(),
  });
