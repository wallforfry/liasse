import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import type { Transaction } from './existing-document.ts';

export type LiveWrite<Result> =
  | { readonly written: true; readonly result: Result }
  /** The document was deleted, or never existed: nothing was written. */
  | { readonly written: false };

/**
 * Runs `write` in a transaction, only while the document is live, and holds the row
 * until that transaction ends.
 *
 * A deletion does not cancel a job that is already running. A handler that computed
 * for minutes and then wrote its result would fill a tombstone again with the content
 * of a deleted document. Every write a job makes to ONE document, or to a row derived
 * from that document alone, goes through here: the row is read `FOR UPDATE` with the
 * tombstone rule, so a deletion either committed before, and nothing is written, or
 * waits for this transaction and then deletes what it wrote.
 *
 * It protects the one document it is given. A row that references two documents, such
 * as a link, goes through `writeIfBothLive`.
 *
 * Given a transaction, the write runs in a savepoint of it and the row stays locked
 * until the caller's transaction ends: that lets a caller take another lock first.
 */
export const writeIfLive = <Result>(
  db: Database | Transaction,
  documentId: string,
  write: (tx: Transaction) => Promise<Result>,
): Promise<LiveWrite<Result>> =>
  db.transaction(async (tx) => {
    const [live] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), isLiveDocument))
      .for('update');
    if (live === undefined) return { written: false };
    return { written: true, result: await write(tx) };
  });

/**
 * Runs `write` only while both documents are live, and holds both rows until the
 * transaction ends: what a row over two documents, such as a link, needs.
 *
 * The rows are locked in the order of their ids, so two writers over the same pair
 * never wait for each other, and `FOR NO KEY UPDATE`, which is all a deletion needs to
 * be held back: `FOR UPDATE` would also block the foreign-key check of another
 * transaction that references one of the two, and two handlers linking A to C and C to
 * A would then deadlock.
 */
export const writeIfBothLive = <Result>(
  db: Database,
  documentIds: readonly [string, string],
  write: (tx: Transaction) => Promise<Result>,
): Promise<LiveWrite<Result>> =>
  db.transaction(async (tx) => {
    const distinct = [...new Set(documentIds)];
    const live = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(inArray(documents.id, distinct), isLiveDocument))
      .orderBy(asc(documents.id))
      .for('no key update');
    if (live.length !== distinct.length) return { written: false };
    return { written: true, result: await write(tx) };
  });

/**
 * Locks the rows of the documents that match, in the order of their ids, before a write
 * that updates them all, such as the rewrite of a merge. An UPDATE locks its rows in the
 * order it meets them; a writer of a link locks its pair in id order. Taken in different
 * orders, the two would each wait for a row the other holds.
 */
export const lockDocumentRows = async (tx: Transaction, condition: SQL): Promise<void> => {
  await tx
    .select({ id: documents.id })
    .from(documents)
    .where(condition)
    .orderBy(asc(documents.id))
    .for('no key update');
};
