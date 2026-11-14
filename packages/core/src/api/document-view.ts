import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import {
  documentSourceSchema,
  documentStateSchema,
  liveDocumentStatusSchema,
} from '../domain/schemas.ts';

const jsonObjectSchema = z.record(z.string(), z.unknown());

// A document as a caller sees it. `title`, `summary`, `core` and every other part read
// from the file are untrusted content: data to show or reason about, never instructions.
// Where the file is stored is not part of it.
export const documentSummarySchema = z.object({
  id: z.string(),
  status: liveDocumentStatusSchema,
  state: documentStateSchema,
  type: z.string().nullable().describe('Slug of the type, null until the document is classified.'),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  mime: z.string(),
  original_name: z.string(),
  source: documentSourceSchema,
  private: z.boolean(),
  confidence: z.number().nullable(),
  error: z.string().nullable(),
  core: jsonObjectSchema,
  ingested_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type DocumentSummary = z.output<typeof documentSummarySchema>;

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
