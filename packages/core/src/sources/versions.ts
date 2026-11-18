import { and, eq, ne, or } from 'drizzle-orm';
import { documents } from '../db/schema/documents.ts';
import { documentOrigins } from '../db/schema/sources.ts';
import { type DeleteDocumentDeps, deleteDocument } from '../ingest/delete-document.ts';
import type { Transaction } from '../ingest/existing-document.ts';

const originOf = (sourceId: string, externalId: string) =>
  and(eq(documentOrigins.sourceId, sourceId), eq(documentOrigins.externalId, externalId));

// Under the lock of the hash: the document goes when this origin is all that holds it,
// its file being at the source. Otherwise only the origin goes, since it no longer
// describes the bytes of the document, which stays for the copy or the other origins.
const onlyHeldBy =
  (sourceId: string, externalId: string, documentId: string) =>
  async (tx: Transaction): Promise<boolean> => {
    const [row] = await tx
      .select({ fileAtSource: documents.fileAtSource })
      .from(documents)
      .where(eq(documents.id, documentId));
    const others = await tx.$count(
      documentOrigins,
      and(
        eq(documentOrigins.documentId, documentId),
        or(ne(documentOrigins.sourceId, sourceId), ne(documentOrigins.externalId, externalId)),
      ),
    );
    if (row?.fileAtSource === true && others === 0) return true;
    await tx
      .delete(documentOrigins)
      .where(and(eq(documentOrigins.documentId, documentId), originOf(sourceId, externalId)));
    return false;
  };

/**
 * After an item of a source that keeps its files was ingested as `currentId`: the
 * documents of its earlier versions, which describe bytes the source no longer holds,
 * are deleted through `deleteDocument`, their tombstone and the forget of their facts
 * included. Resolves to the number of documents deleted.
 */
export const replaceOlderVersions = async (
  deps: DeleteDocumentDeps,
  sourceId: string,
  externalId: string,
  currentId: string,
): Promise<number> => {
  const older = await deps.db
    .select({ documentId: documentOrigins.documentId })
    .from(documentOrigins)
    .where(and(originOf(sourceId, externalId), ne(documentOrigins.documentId, currentId)));
  let deleted = 0;
  for (const { documentId } of older) {
    const when = onlyHeldBy(sourceId, externalId, documentId);
    if (await deleteDocument(deps, documentId, { when, replacedBySource: true })) deleted += 1;
  }
  return deleted;
};
