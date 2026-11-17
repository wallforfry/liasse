import {
  type DocumentList,
  type ListDocumentsOptions,
  listDocumentsOptionsSchema,
} from '@liasse/contract';
import { and, desc, eq } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { documentFilter } from '../search/filters.ts';
import type { ApiContext } from './context.ts';
import { SUMMARY_COLUMNS, toDocumentSummary } from './document-view.ts';

/**
 * Documents, most recently ingested first. Tombstones are never listed. The filters are
 * those of search: a type is named by its slug or an alias and brings the documents of
 * the types merged into it, and a name no type bears lists nothing; an entity is named by
 * its id and brings the documents that name it in any entity field.
 */
export const listDocuments = async (
  { db }: Pick<ApiContext, 'db'>,
  options: ListDocumentsOptions = {},
): Promise<DocumentList> => {
  const {
    status,
    type,
    entity,
    private: privacy,
    limit,
    offset,
  } = listDocumentsOptionsSchema.parse(options);
  const matching = and(
    isLiveDocument,
    documentFilter(
      {
        ...(status === undefined ? {} : { status }),
        ...(type === undefined ? {} : { type }),
        ...(entity === undefined ? {} : { entity }),
      },
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
