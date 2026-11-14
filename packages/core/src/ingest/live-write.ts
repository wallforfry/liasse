import { and, eq } from 'drizzle-orm';
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
 * of a deleted document. Every write a job makes to a document, or to a row derived
 * from it, goes through here: the row is read `FOR UPDATE` with the tombstone rule, so
 * a deletion either committed before, and nothing is written, or waits for this
 * transaction and then deletes what it wrote.
 */
export const writeIfLive = <Result>(
  db: Database,
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
