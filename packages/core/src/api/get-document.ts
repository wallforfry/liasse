import {
  type DocumentPart,
  type DocumentView,
  type GetDocumentOptions,
  getDocumentOptionsSchema,
} from '@liasse/contract';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documentPages, documents, isLiveDocument } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { ApiContext } from './context.ts';
import { SUMMARY_COLUMNS, toDocumentSummary } from './document-view.ts';
import { documentNotFound } from './errors.ts';

// Between the pages of the text given as one string.
const PAGE_SEPARATOR = '\n\n';

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
