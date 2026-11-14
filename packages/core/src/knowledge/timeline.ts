import { and, asc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { documentRefSchema, untrustedText } from '../contract/knowledge.ts';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { facts } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import { DEFAULT_TIMELINE_LIMIT, MAX_TIMELINE_LIMIT } from '../domain/limits.ts';
import { documentStateSchema } from '../domain/schemas.ts';
import { isoDateSchema } from '../domain/values.ts';
import { namesEntity } from '../entities/references.ts';
import type { KnowledgeReadContext } from './context.ts';
import { statedDocumentDate } from './document-day.ts';
import { effectiveState, holdsId, visibleDocument } from './read-shared.ts';

export const timelineInputSchema = z
  .strictObject({
    // The id of a subject, or the id of an entity: one of the two.
    subject: z.string().min(1).optional(),
    entity: z.string().min(1).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    includePrivate: z.boolean().default(false),
    limit: z.int().min(1).max(MAX_TIMELINE_LIMIT).default(DEFAULT_TIMELINE_LIMIT),
  })
  .refine(({ subject, entity }) => (subject === undefined) !== (entity === undefined), {
    message: 'expected either a subject or an entity',
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    path: ['to'],
    message: 'expected the end of the window on or after its start',
  });
export type TimelineInput = z.input<typeof timelineInputSchema>;

export const timelineFactSchema = z.strictObject({
  id: z.string(),
  text: untrustedText,
  validFrom: isoDateSchema.nullable(),
  validTo: isoDateSchema.nullable(),
  // The document the fact was read in.
  documentId: z.string(),
});

// The date of a document is the one it states; the date of a fact is the start of its
// validity, or the date of its document. Null when neither is known: such an item comes
// last, and is left out of a window.
export const timelineItemSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('document'),
    date: isoDateSchema.nullable(),
    document: documentRefSchema,
    state: documentStateSchema,
  }),
  z.strictObject({
    kind: z.literal('fact'),
    date: isoDateSchema.nullable(),
    fact: timelineFactSchema,
  }),
]);
export type TimelineItem = z.output<typeof timelineItemSchema>;

export const timelineOutputSchema = z.strictObject({
  items: z.array(timelineItemSchema).readonly(),
  // True when the chronology holds more items than the limit.
  truncated: z.boolean(),
});
export type Timeline = z.output<typeof timelineOutputSchema>;

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
      validFrom: facts.validFrom,
      validTo: facts.validTo,
      documentId: facts.documentId,
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
