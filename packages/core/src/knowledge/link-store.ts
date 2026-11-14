import { and, eq, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { writeIfBothLive } from '../ingest/live-write.ts';
import { recomputeDocumentStates } from './document-state.ts';
import type { ValidLink } from './link-rules.ts';
import { admitSupersedes } from './supersede-rules.ts';

const LINK_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('liasse.document_links'))`;

const between = (left: string, right: string) =>
  or(
    and(eq(documentLinks.fromDocumentId, left), eq(documentLinks.toDocumentId, right)),
    and(eq(documentLinks.fromDocumentId, right), eq(documentLinks.toDocumentId, left)),
  );

const insertLinks = async (
  tx: Transaction,
  links: readonly ValidLink[],
  model: string,
): Promise<number> => {
  let written = 0;
  for (const link of links) {
    if (link.kind === 'supersedes' && !(await admitSupersedes(tx, link))) continue;
    const { rationale, ...row } = link;
    await tx.insert(documentLinks).values({ ...row, model, quote: rationale });
    written += 1;
  }
  return written;
};

export type PairWrite =
  | { readonly written: true; readonly links: number }
  /** One of the two documents was deleted meanwhile: nothing was written. */
  | { readonly written: false };

/**
 * Replaces the links between two documents by those given, and sets the state of both
 * to what their links then say, all or nothing.
 *
 * A link is a row over two documents: both rows are locked in the order of their ids,
 * `FOR NO KEY UPDATE`, and both are checked to be live (`writeIfBothLive`). A deletion of
 * either therefore committed before, and nothing is written, or waits and then removes
 * the link and computes the state again. Writers of links then take one lock of their
 * own, after the rows: the search for a loop of `supersedes` reads links between other
 * documents, and is only true if no other writer adds one meanwhile. Nothing else takes
 * that lock, and its holder waits for no row, so it cannot be part of a deadlock.
 */
export const replaceLinksBetween = async (
  db: Database,
  pair: readonly [string, string],
  links: readonly ValidLink[],
  model: string,
): Promise<PairWrite> => {
  const [left, right] = pair;
  const outcome = await writeIfBothLive(db, pair, async (tx) => {
    await tx.execute(LINK_LOCK);
    await tx.delete(documentLinks).where(between(left, right));
    const written = await insertLinks(tx, links, model);
    await recomputeDocumentStates(tx, [left, right]);
    return written;
  });
  return outcome.written ? { written: true, links: outcome.result } : { written: false };
};
