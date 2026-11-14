import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import {
  type Timeline,
  type TimelineInput,
  type TimelineItem,
  timelineInputSchema,
} from '../contract/knowledge-reads.ts';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { namesEntity } from '../entities/references.ts';
import type { KnowledgeReadContext } from './context.ts';
import { statedDocumentDate } from './document-day.ts';
import { effectiveState, holdsId, visibleDocument } from './read-shared.ts';

interface Scope {
  readonly ofDocument: SQL;
  readonly ofFact: SQL;
}

const within = (date: SQL, from: string | undefined, to: string | undefined): SQL | undefined =>
  and(
    from === undefined ? undefined : sql`${date} >= ${from}`,
    to === undefined ? undefined : sql`${date} <= ${to}`,
  );

const readDocuments = async (
  db: Database,
  where: SQL | undefined,
  limit: number,
): Promise<readonly TimelineItem[]> => {
  const rows = await db
    .select({
      date: statedDocumentDate,
      id: documents.id,
      title: documents.title,
      type: docTypes.slug,
      state: effectiveState,
    })
    .from(documents)
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(where)
    .orderBy(sql`${statedDocumentDate} ASC NULLS LAST`, asc(documents.id))
    .limit(limit);
  return rows.map(({ date, state, ...document }) => ({
    kind: 'document',
    date,
    document,
    state,
  }));
};

const FACT_DATE = sql<string | null>`COALESCE(${facts.validFrom}::text, ${statedDocumentDate})`;

const readFacts = async (
  db: Database,
  where: SQL | undefined,
  limit: number,
): Promise<readonly TimelineItem[]> => {
  const rows = await db
    .select({
      date: FACT_DATE,
      id: facts.id,
      text: facts.text,
      valid_from: facts.validFrom,
      valid_to: facts.validTo,
      document_id: facts.documentId,
    })
    .from(facts)
    .innerJoin(documents, eq(documents.id, facts.documentId))
    .where(where)
    .orderBy(sql`${FACT_DATE} ASC NULLS LAST`, asc(facts.id))
    .limit(limit);
  return rows.map(({ date, ...fact }) => ({ kind: 'fact', date, fact }));
};

const idOf = (item: TimelineItem): string =>
  item.kind === 'document' ? item.document.id : item.fact.id;

// Chronological, undated items last. On one day a document comes before the facts, which
// were read in documents.
const chronological = (left: TimelineItem, right: TimelineItem): number => {
  if (left.date !== right.date) {
    if (left.date === null) return 1;
    if (right.date === null) return -1;
    return left.date < right.date ? -1 : 1;
  }
  if (left.kind !== right.kind) return left.kind === 'document' ? -1 : 1;
  return idOf(left) < idOf(right) ? -1 : 1;
};

/**
 * The chronology of a subject or of an entity: the documents that concern it and the
 * facts about it, oldest first. For an entity, the documents are those that name it in
 * an entity-typed field. Only what is stored: no fact is derived here.
 */
export const timeline = async (
  { db }: KnowledgeReadContext,
  input: TimelineInput,
): Promise<Timeline> => {
  const { subject, entity, from, to, includePrivate, limit } = timelineInputSchema.parse(input);
  const scope: Scope =
    subject === undefined
      ? {
          ofDocument: namesEntity(entity ?? ''),
          ofFact: holdsId(facts.entityIds, entity ?? ''),
        }
      : {
          ofDocument: holdsId(documents.subjectIds, subject),
          ofFact: holdsId(facts.subjectIds, subject),
        };
  const visible = visibleDocument(includePrivate);
  const [documentItems, factItems] = await Promise.all([
    readDocuments(
      db,
      and(scope.ofDocument, visible, within(statedDocumentDate, from, to)),
      limit + 1,
    ),
    readFacts(db, and(scope.ofFact, visible, within(FACT_DATE, from, to)), limit + 1),
  ]);
  const items = [...documentItems, ...factItems].toSorted(chronological);
  return { items: items.slice(0, limit), truncated: items.length > limit };
};
