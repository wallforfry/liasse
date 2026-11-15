import type { DocumentState, LinkKind } from '@liasse/contract/domain';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import type { EntityTransaction } from '../entities/entity-store.ts';

const TERMINATED = 'terminated' satisfies DocumentState;
const SUPERSEDED = 'superseded' satisfies DocumentState;
const CURRENT = 'current' satisfies DocumentState;

const isTargetOf = (kind: LinkKind): SQL =>
  sql`EXISTS (
    SELECT 1 FROM ${documentLinks}
    WHERE ${documentLinks.toDocumentId} = ${documents.id} AND ${documentLinks.kind} = ${kind}
  )`;

// The state of a document follows from the links that point at it, and from nothing else:
// terminated when a document terminates it, superseded when one supersedes it, current
// otherwise. A termination is final, so it wins over a newer version. A link never points
// at or from a tombstone: deletion removes the links of a document with it.
const DERIVED_STATE = sql`(CASE
  WHEN ${isTargetOf('terminates')} THEN ${TERMINATED}
  WHEN ${isTargetOf('supersedes')} THEN ${SUPERSEDED}
  ELSE ${CURRENT}
END)::document_state`;

/**
 * Sets `documents.state` of the given documents to what their links say. Called in the
 * transaction that changed the links, by whoever holds the rows of these documents: the
 * writer of a link for its two documents, the deletion of a document for the documents
 * it pointed at.
 */
export const recomputeDocumentStates = async (
  tx: EntityTransaction,
  documentIds: readonly string[],
): Promise<void> => {
  if (documentIds.length === 0) return;
  await tx
    .update(documents)
    .set({ state: DERIVED_STATE })
    .where(
      and(
        inArray(documents.id, [...documentIds]),
        isLiveDocument,
        sql`${documents.state} <> ${DERIVED_STATE}`,
      ),
    );
};

const targetsOf = async (tx: EntityTransaction, documentId: string): Promise<readonly string[]> =>
  (
    await tx
      .selectDistinct({ id: documentLinks.toDocumentId })
      .from(documentLinks)
      .where(eq(documentLinks.fromDocumentId, documentId))
  ).map(({ id }) => id);

class LinksChangedError extends Error {
  override readonly name: string = 'LinksChangedError';
}

// Links are written a few times per document: a deletion that met a new one at each of
// these attempts is not racing, something is wrong.
const LOCK_ATTEMPTS = 5;

/**
 * Locks the row of a document about to be deleted and the rows of the documents it
 * points at, in the order of their ids, and answers with the ids of the latter: their
 * state may rest on a link that goes with the document.
 *
 * The order is the one a link is written in (`writeIfBothLive`), so a deletion and the
 * writer of a link between the same documents never wait for each other. A link written
 * after this needs the row of the deleted document, waits, and then finds a tombstone.
 *
 * A link committed while this waited for a row is not in what it read before waiting:
 * the targets are read again once the rows are held. When there is a new one, the locks
 * are given back and taken again with it, rather than taken out of order.
 */
export const lockLinkedDocuments = async (
  tx: EntityTransaction,
  documentId: string,
): Promise<readonly string[]> => {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const expected = await targetsOf(tx, documentId);
    try {
      // A savepoint: leaving it by an error releases the row locks taken in it.
      return await tx.transaction(async (savepoint) => {
        await savepoint
          .select({ id: documents.id })
          .from(documents)
          .where(inArray(documents.id, [documentId, ...expected]))
          .orderBy(asc(documents.id))
          .for('no key update');
        const held = await targetsOf(savepoint, documentId);
        if (held.some((id) => !expected.includes(id))) throw new LinksChangedError();
        return held;
      });
    } catch (error) {
      if (!(error instanceof LinksChangedError)) throw error;
    }
  }
  throw new Error(`The links of document ${documentId} kept changing while it was deleted`);
};
