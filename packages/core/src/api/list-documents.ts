import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { liveDocumentStatusSchema } from '../domain/schemas.ts';
import { documentFilter } from '../search/filters.ts';
import type { ApiContext } from './context.ts';
import { documentSummarySchema, SUMMARY_COLUMNS, toDocumentSummary } from './document-view.ts';

export const DEFAULT_DOCUMENT_LIST_LIMIT = 50;
export const MAX_DOCUMENT_LIST_LIMIT = 200;

// Like search, a list leaves private documents out unless they are asked for.
export const PRIVATE_FILTERS = ['exclude', 'include', 'only'] as const;
export type PrivateFilter = (typeof PRIVATE_FILTERS)[number];

export const listDocumentsOptionsSchema = z.strictObject({
  status: liveDocumentStatusSchema.optional(),
  type: z.string().min(1).optional().describe('Slug or alias of a type.'),
  private: z.enum(PRIVATE_FILTERS).default('exclude'),
  limit: z.int().min(1).max(MAX_DOCUMENT_LIST_LIMIT).default(DEFAULT_DOCUMENT_LIST_LIMIT),
  offset: z.int().min(0).default(0),
});
export type ListDocumentsOptions = z.input<typeof listDocumentsOptionsSchema>;

export const documentListSchema = z.object({
  documents: z.array(documentSummarySchema),
  total: z.int().describe('How many documents match, whatever the page.'),
  has_more: z.boolean(),
});
export type DocumentList = z.output<typeof documentListSchema>;

/**
 * Documents, most recently ingested first. Tombstones are never listed. The filters are
 * those of search: a type is named by its slug or an alias and brings the documents of
 * the types merged into it, and a name no type bears lists nothing.
 */
export const listDocuments = async (
  { db }: Pick<ApiContext, 'db'>,
  options: ListDocumentsOptions = {},
): Promise<DocumentList> => {
  const {
    status,
    type,
    private: privacy,
    limit,
    offset,
  } = listDocumentsOptionsSchema.parse(options);
  const matching = and(
    isLiveDocument,
    documentFilter(
      { ...(status === undefined ? {} : { status }), ...(type === undefined ? {} : { type }) },
      privacy !== 'exclude',
    ),
    privacy === 'only' ? eq(documents.private, true) : undefined,
  );
  const [rows, total] = await Promise.all([
    db
      .select(SUMMARY_COLUMNS)
      .from(documents)
      .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
      .where(matching)
      .orderBy(desc(documents.ingestedAt), desc(documents.id))
      .limit(limit)
      .offset(offset),
    db.$count(documents, matching),
  ]);
  return {
    documents: rows.map(toDocumentSummary),
    total,
    has_more: offset + rows.length < total,
  };
};
