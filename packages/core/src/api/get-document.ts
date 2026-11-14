import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documentPages, documents, isLiveDocument } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { ApiContext } from './context.ts';
import { documentSummarySchema, SUMMARY_COLUMNS, toDocumentSummary } from './document-view.ts';
import { documentNotFound } from './errors.ts';

export const DOCUMENT_PARTS = ['fields', 'text', 'pages', 'file_url', 'provenance'] as const;
export type DocumentPart = (typeof DOCUMENT_PARTS)[number];

export const DEFAULT_TEXT_LENGTH = 20_000;
export const MAX_TEXT_LENGTH = 100_000;
export const DEFAULT_PAGE_COUNT = 20;
export const MAX_PAGE_COUNT = 100;

// Between the pages of the text given as one string.
const PAGE_SEPARATOR = '\n\n';

export const getDocumentOptionsSchema = z.strictObject({
  include: z.array(z.enum(DOCUMENT_PARTS)).default([]),
  text_offset: z.int().min(0).default(0).describe('First character of the text returned.'),
  text_limit: z.int().min(1).max(MAX_TEXT_LENGTH).default(DEFAULT_TEXT_LENGTH),
  page_from: z.int().min(1).default(1).describe('First page returned.'),
  page_limit: z.int().min(1).max(MAX_PAGE_COUNT).default(DEFAULT_PAGE_COUNT),
});
export type GetDocumentOptions = z.input<typeof getDocumentOptionsSchema>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

const textPartSchema = z.object({
  content: z.string(),
  offset: z.int(),
  total_length: z.int().describe('Characters of the whole text.'),
  has_more: z.boolean(),
});

const pagesPartSchema = z.object({
  items: z.array(z.object({ page: z.int(), text: z.string(), language: z.string().nullable() })),
  total: z.int(),
  has_more: z.boolean(),
});

export const documentSchema = documentSummarySchema.extend({
  schema_version: z.int().nullable(),
  hint: z.string().nullable(),
  fields: jsonObjectSchema.optional(),
  extra: jsonObjectSchema.optional(),
  manual_fields: z.array(z.string()).optional(),
  provenance: jsonObjectSchema.optional(),
  text: textPartSchema.optional(),
  pages: pagesPartSchema.optional(),
  file_url: z
    .url()
    .optional()
    .describe('Signed URL of the original file, valid for 15 minutes without a token.'),
});
export type DocumentView = z.output<typeof documentSchema>;

type Options = z.output<typeof getDocumentOptionsSchema>;

// The slice is cut by Postgres, so a long document is never loaded whole to return a
// part of it. Postgres counts characters, not UTF-16 units.
const readText = async (db: Database, id: string, { text_offset, text_limit }: Options) => {
  const whole = sql<string>`coalesce(string_agg(${documentPages.text}, ${PAGE_SEPARATOR} ORDER BY ${documentPages.page}), '')`;
  const [row] = await db
    .select({
      content: sql<string>`substr(${whole}, ${text_offset + 1}::int, ${text_limit}::int)`,
      totalLength: sql<number>`length(${whole})::int`,
    })
    .from(documentPages)
    .where(eq(documentPages.documentId, id));
  const { content = '', totalLength = 0 } = row ?? {};
  return {
    content,
    offset: text_offset,
    total_length: totalLength,
    has_more: text_offset + text_limit < totalLength,
  };
};

const readPages = async (db: Database, id: string, { page_from, page_limit }: Options) => {
  const ofDocument = eq(documentPages.documentId, id);
  const [rows, total] = await Promise.all([
    db
      .select({
        page: documentPages.page,
        text: documentPages.text,
        language: documentPages.language,
      })
      .from(documentPages)
      .where(and(ofDocument, gte(documentPages.page, page_from)))
      .orderBy(asc(documentPages.page))
      .limit(page_limit + 1),
    db.$count(documentPages, ofDocument),
  ]);
  return { items: rows.slice(0, page_limit), total, has_more: rows.length > page_limit };
};

/**
 * A document with the parts asked for. Rejects with `document_not_found` for an id
 * that is unknown or deleted. A private document is returned: asking for it by its id
 * is asking for it explicitly.
 */
export const getDocument = async (
  { db, fileUrls }: Pick<ApiContext, 'db' | 'fileUrls'>,
  id: string,
  rawOptions: GetDocumentOptions = {},
): Promise<DocumentView> => {
  const options = getDocumentOptionsSchema.parse(rawOptions);
  const wants = (part: DocumentPart): boolean => options.include.includes(part);
  const [row] = await db
    .select({
      ...SUMMARY_COLUMNS,
      schemaVersion: documents.schemaVersion,
      hint: documents.hint,
      fields: documents.fields,
      extra: documents.extra,
      manualFields: documents.manualFields,
      provenance: documents.provenance,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(and(eq(documents.id, id), isLiveDocument));
  if (row === undefined) throw documentNotFound();
  const { schemaVersion, hint, fields, extra, manualFields, provenance, ...summary } = row;
  return {
    ...toDocumentSummary(summary),
    schema_version: schemaVersion,
    hint,
    ...(wants('fields') ? { fields, extra, manual_fields: [...manualFields] } : {}),
    ...(wants('provenance') ? { provenance } : {}),
    ...(wants('text') ? { text: await readText(db, id, options) } : {}),
    ...(wants('pages') ? { pages: await readPages(db, id, options) } : {}),
    ...(wants('file_url') ? { file_url: fileUrls.sign(id) } : {}),
  };
};
