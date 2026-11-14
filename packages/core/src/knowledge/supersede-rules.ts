import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { documentLinks } from '../db/schema/knowledge.ts';
import type { LinkKind } from '../domain/enums.ts';
import type { Transaction } from '../ingest/existing-document.ts';
import { documentDay } from './document-day.ts';
import type { ValidLink } from './link-rules.ts';

const SUPERSEDES = 'supersedes' satisfies LinkKind;

const reachedSchema = z.array(z.object({ reached: z.boolean() }));

// True when the document to supersede already supersedes, through any number of
// documents, the one that would supersede it: the new link would close a loop. The union
// of the recursion keeps each document once, so it ends on a loop that is already there.
const closesLoop = async (tx: Transaction, { fromDocumentId, toDocumentId }: ValidLink) => {
  const rows = reachedSchema.parse(
    await tx.execute(sql`
      WITH RECURSIVE superseded(id) AS (
        SELECT ${documentLinks.toDocumentId} FROM ${documentLinks}
        WHERE ${documentLinks.fromDocumentId} = ${toDocumentId}
          AND ${documentLinks.kind} = ${SUPERSEDES}
        UNION
        SELECT next_link.to_document_id
        FROM ${documentLinks} AS next_link
        JOIN superseded ON next_link.from_document_id = superseded.id
        WHERE next_link.kind = ${SUPERSEDES}
      )
      SELECT EXISTS (SELECT 1 FROM superseded WHERE id = ${fromDocumentId}) AS reached
    `),
  );
  return rows[0]?.reached ?? false;
};

const supersedes = eq(documentLinks.kind, SUPERSEDES);

// A document supersedes one document: the one it was first found to replace stays.
const supersedesAnother = async (tx: Transaction, { fromDocumentId, toDocumentId }: ValidLink) =>
  (
    await tx
      .select({ id: documentLinks.id })
      .from(documentLinks)
      .where(
        and(
          supersedes,
          eq(documentLinks.fromDocumentId, fromDocumentId),
          ne(documentLinks.toDocumentId, toDocumentId),
        ),
      )
      .limit(1)
  ).length > 0;

interface Superseder {
  readonly linkId: string;
  readonly documentId: string;
  readonly confidence: number;
  readonly day: string;
}

const daysOf = async (
  tx: Transaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> =>
  new Map(
    (
      await tx
        .select({ id: documents.id, day: documentDay })
        .from(documents)
        .where(inArray(documents.id, [...ids]))
    ).map(({ id, day }) => [id, day]),
  );

const othersSuperseding = async (
  tx: Transaction,
  { fromDocumentId, toDocumentId }: ValidLink,
): Promise<readonly Superseder[]> => {
  const links = await tx
    .select({
      linkId: documentLinks.id,
      documentId: documentLinks.fromDocumentId,
      confidence: documentLinks.confidence,
    })
    .from(documentLinks)
    .where(
      and(
        supersedes,
        eq(documentLinks.toDocumentId, toDocumentId),
        ne(documentLinks.fromDocumentId, fromDocumentId),
      ),
    );
  const days = await daysOf(
    tx,
    links.map(({ documentId }) => documentId),
  );
  return links.map((link) => ({
    ...link,
    confidence: link.confidence ?? 0,
    day: days.get(link.documentId) ?? '',
  }));
};

// The newer document is the newer version; on one day, the surer link; on a tie, the
// one already written.
const replaces = (day: string, confidence: number, other: Superseder): boolean =>
  day > other.day || (day === other.day && confidence > other.confidence);

/**
 * Whether a `supersedes` link may be written next to the links already there, and what
 * it displaces. A document supersedes one document and is superseded by one, whatever the
 * detection that found them: the more recent superseder wins, then the surer link, then
 * the link already written; a second target of a superseder is not written. No loop of
 * `supersedes` is ever closed. Runs under the lock of the links, after the rows of the
 * two documents: a displaced superseder keeps its state, which outgoing links do not set,
 * so no other row is written.
 */
export const admitSupersedes = async (tx: Transaction, link: ValidLink): Promise<boolean> => {
  if ((await closesLoop(tx, link)) || (await supersedesAnother(tx, link))) return false;
  const others = await othersSuperseding(tx, link);
  if (others.length === 0) return true;
  const day = (await daysOf(tx, [link.fromDocumentId])).get(link.fromDocumentId) ?? '';
  if (!others.every((other) => replaces(day, link.confidence, other))) return false;
  await tx.delete(documentLinks).where(
    inArray(
      documentLinks.id,
      others.map(({ linkId }) => linkId),
    ),
  );
  return true;
};
