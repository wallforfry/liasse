import { and, desc, eq, inArray, isNotNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { documents, isLiveDocument } from '../db/schema/documents.ts';
import { documentDates } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import type { KeyDateKind } from '../domain/enums.ts';
import {
  LINK_CANDIDATE_POOL,
  LINK_WINDOW_MONTHS,
  MAX_LINK_CANDIDATES,
  MAX_LINK_CANDIDATES_PER_TYPE,
} from '../domain/limits.ts';
import { entityIdProvenancePath } from '../domain/provenance.ts';
import { type Money, moneySchema } from '../domain/values.ts';
import { documentDay, statedDocumentDate } from './document-day.ts';
import { shiftMonths } from './notice-deadline.ts';

// What link detection knows of a document: what says which documents it may be linked
// to, and what the text model is shown of it.
export interface LinkDocument {
  readonly id: string;
  readonly title: string | null;
  readonly summary: string | null;
  readonly type: string | null;
  // The date the document states, and the day it is placed at (see `documentDay`).
  readonly statedDate: string | null;
  readonly day: string;
  readonly reference: string | null;
  readonly amount: Money | null;
  readonly issuerId: string | null;
  readonly subjectIds: readonly string[];
}

const ISSUER_ID = sql<string | null>`${documents.provenance} #>> ${sql.raw(
  `'{${entityIdProvenancePath('issuer').join(',')}}'`,
)}`;

const REFERENCE = sql<string | null>`${documents.core} ->> 'reference'`;

const COLUMNS = {
  id: documents.id,
  title: documents.title,
  summary: documents.summary,
  type: docTypes.slug,
  statedDate: statedDocumentDate,
  day: documentDay,
  reference: REFERENCE,
  amount: sql<unknown>`${documents.core} -> 'amount'`,
  issuerId: ISSUER_ID,
  subjectIds: documents.subjectIds,
} as const;

interface Row extends Omit<LinkDocument, 'amount'> {
  readonly amount: unknown;
}

const toLinkDocument = ({ amount, ...row }: Row): LinkDocument => ({
  ...row,
  amount: moneySchema.safeParse(amount).data ?? null,
});

// Undefined for a tombstone, and for an id no document has.
export const readLinkSource = async (
  db: Database,
  documentId: string,
): Promise<LinkDocument | undefined> => {
  const [row] = await db
    .select(COLUMNS)
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(and(eq(documents.id, documentId), isLiveDocument));
  return row === undefined ? undefined : toLinkDocument(row);
};

// Case, spaces and separators say nothing about which reference it is.
const normalized = (reference: SQL | string): SQL =>
  sql`regexp_replace(upper(${reference}), '[^[:alnum:]]', '', 'g')`;

// Under this length a reference is a fragment: "1" is the reference of many documents.
const MIN_REFERENCE_LENGTH = 3;

const sharesReference = ({ reference }: LinkDocument): SQL | undefined =>
  reference === null
    ? undefined
    : sql`(length(${normalized(reference)}) >= ${MIN_REFERENCE_LENGTH}
        AND ${normalized(REFERENCE)} = ${normalized(reference)})`;

const sharesSubject = ({ subjectIds }: LinkDocument): SQL | undefined =>
  subjectIds.length === 0
    ? undefined
    : sql`${documents.subjectIds} && ARRAY[${sql.join(
        subjectIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[]`;

const sharesIssuer = ({ issuerId }: LinkDocument): SQL | undefined =>
  issuerId === null ? undefined : sql`${ISSUER_ID} = ${issuerId}`;

const isTrue = (condition: SQL | undefined): SQL =>
  sql`COALESCE(${condition ?? sql`false`}, false)`;

const sharesType = ({ type }: LinkDocument): SQL | undefined =>
  type === null ? undefined : sql`${docTypes.slug} = ${type}`;

const CONTRACT_DATE_KINDS: readonly KeyDateKind[] = ['renewal', 'expiry', 'effective'];

// A document that states when it starts, renews or ends is the kind of document others
// supersede, amend and terminate.
const statesContractDates = sql`EXISTS (
  SELECT 1 FROM ${documentDates}
  WHERE ${documentDates.documentId} = ${documents.id}
    AND ${inArray(documentDates.kind, [...CONTRACT_DATE_KINDS])}
)`;

// The candidates kept from the ranked pool, in its order: at most `perType` of one type
// first, the documents without a type counting as one, then the best of the others for
// the places left. A year of bills does not take every place of the contract they bill.
export const withTypeQuota = <Candidate extends { readonly type: string | null }>(
  ranked: readonly Candidate[],
  places: number,
  perType: number,
): readonly Candidate[] => {
  const firstPass = ranked.filter(
    (candidate, index) =>
      ranked.slice(0, index).filter(({ type }) => type === candidate.type).length < perType,
  );
  const kept = new Set(
    [
      ...firstPass.slice(0, places),
      ...ranked.filter((candidate) => !firstPass.includes(candidate)),
    ].slice(0, places),
  );
  return ranked.filter((candidate) => kept.has(candidate));
};

/**
 * The documents a document may be linked to, as the specification bounds them: the same
 * issuer, a shared subject or the same reference, dated within twelve months of it.
 * Before and after: documents are not ingested in the order they were written, and the
 * contract may come in after the letter that terminates it. Never a tombstone, never a
 * document without a title or a summary to judge it by, and at most `MAX_LINK_CANDIDATES`.
 *
 * They are ranked by what makes a link likely: the type of the document first (a new
 * contract supersedes a contract), then a document that states contract dates, then the
 * same reference, a shared subject, and the most recent; and one type takes at most
 * `MAX_LINK_CANDIDATES_PER_TYPE` places while others are there (`withTypeQuota`).
 *
 * A `private` document is a candidate like another. The flag keeps a document away from
 * Hindsight, from external embeddings and from search results; it never kept it from the
 * text model, which has read its whole text at extraction. Its title and summary go to
 * that same model and nowhere else, and the readers of links leave private documents out
 * unless asked.
 */
export const findLinkCandidates = async (
  db: Database,
  source: LinkDocument,
): Promise<readonly LinkDocument[]> => {
  const relations = [sharesReference(source), sharesSubject(source), sharesIssuer(source)];
  const [byReference, bySubject] = relations;
  const from = shiftMonths(source.day, -LINK_WINDOW_MONTHS);
  const to = shiftMonths(source.day, LINK_WINDOW_MONTHS);
  if (relations.every((relation) => relation === undefined) || from === undefined) return [];
  const rows = await db
    .select(COLUMNS)
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(
      and(
        ne(documents.id, source.id),
        isLiveDocument,
        or(isNotNull(documents.title), isNotNull(documents.summary)),
        sql`${documentDay} >= ${from}`,
        to === undefined ? undefined : sql`${documentDay} <= ${to}`,
        or(...relations),
      ),
    )
    .orderBy(
      desc(isTrue(sharesType(source))),
      desc(statesContractDates),
      desc(isTrue(byReference)),
      desc(isTrue(bySubject)),
      desc(documentDay),
      documents.id,
    )
    .limit(LINK_CANDIDATE_POOL);
  return withTypeQuota(rows.map(toLinkDocument), MAX_LINK_CANDIDATES, MAX_LINK_CANDIDATES_PER_TYPE);
};
