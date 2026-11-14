import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.ts';
import { documents } from '../db/schema/documents.ts';
import { docTypes } from '../db/schema/registry.ts';
import { nameTokens } from '../domain/entity-name.ts';
import { ID_PREFIXES, isId } from '../domain/ids.ts';
import {
  MAX_SUBJECT_DOCUMENTS,
  MAX_SUBJECT_NAME_LENGTH,
  MAX_SUBJECT_NEXT_DATES,
  MAX_SUBJECT_SUGGESTIONS,
} from '../domain/limits.ts';
import {
  documentStateSchema,
  subjectIdentifierTypeSchema,
  subjectKindSchema,
} from '../domain/schemas.ts';
import { isoDateSchema } from '../domain/values.ts';
import type { KnowledgeReadContext } from './context.ts';
import { statedDocumentDate } from './document-day.ts';
import {
  documentRefSchema,
  effectiveState,
  holdsId,
  subjectRefSchema,
  untrustedText,
  visibleDocument,
  visibleSubjectIds,
} from './read-shared.ts';
import { isWrittenAs, viewSubjectIdentifier } from './subject-identifiers.ts';
import { subjectLabelKey } from './subject-label.ts';
import { deriveSubjectState, readSubjectDocumentStates } from './subject-state.ts';
import { findSubjectById, loadSubjects, type Subject } from './subject-store.ts';
import { upcoming, upcomingDateSchema } from './upcoming.ts';

const LAST_DAY = '9999-12-31';

const today = (): string => new Date().toISOString().slice(0, 10);

export const getSubjectInputSchema = z
  .strictObject({
    // The id of a subject, or words to find it by: a label, a plate, an address.
    id: z.string().min(1).optional(),
    query: z.string().trim().min(1).max(MAX_SUBJECT_NAME_LENGTH).optional(),
    // The day the next dates are counted from: today (UTC) when absent.
    asOf: isoDateSchema.optional(),
    includePrivate: z.boolean().default(false),
  })
  .refine(({ id, query }) => (id === undefined) !== (query === undefined), {
    message: 'expected either an id or a query',
  });
export type GetSubjectInput = z.input<typeof getSubjectInputSchema>;

const subjectDocumentSchema = documentRefSchema.extend({
  // The date the document states, null when it states none.
  date: isoDateSchema.nullable(),
  state: documentStateSchema,
});

export const subjectDetailsSchema = z.strictObject({
  found: z.literal(true),
  subject: z.strictObject({
    id: z.string(),
    kind: subjectKindSchema,
    name: untrustedText,
    aliases: z.array(untrustedText).readonly(),
    // An IBAN or a card number is masked.
    identifiers: z
      .array(z.strictObject({ type: subjectIdentifierTypeSchema, value: untrustedText }))
      .readonly(),
  }),
  // Derived from the states of its documents: see `deriveSubjectState`.
  state: documentStateSchema,
  // The most recent first, at most `MAX_SUBJECT_DOCUMENTS`.
  documents: z.array(subjectDocumentSchema).readonly(),
  documentCount: z.int().min(0),
  // The first key dates on or after `asOf`, those of ended documents left out.
  nextDates: z.array(upcomingDateSchema).readonly(),
});
export type SubjectDetails = z.output<typeof subjectDetailsSchema>;

export const subjectNotFoundSchema = z.strictObject({
  found: z.literal(false),
  // The subjects a query may have meant, when it names none or several.
  suggestions: z.array(subjectRefSchema).readonly(),
});

export const getSubjectOutputSchema = z.discriminatedUnion('found', [
  subjectDetailsSchema,
  subjectNotFoundSchema,
]);
export type GetSubjectOutput = z.output<typeof getSubjectOutputSchema>;

const namesOf = ({ canonicalName, aliases }: Subject): readonly string[] => [
  canonicalName,
  ...aliases,
];

// The subjects a query designates, the surest reading first: a whole label, then an
// identifier as written, then words that each start a word of one label.
const designatedBy = (subjects: readonly Subject[], query: string): readonly Subject[] => {
  const key = subjectLabelKey(query);
  const byLabel = subjects.filter((subject) =>
    namesOf(subject).some((name) => subjectLabelKey(name) === key),
  );
  if (byLabel.length > 0) return byLabel;
  const byIdentifier = subjects.filter(({ identifiers }) =>
    identifiers.some((identifier) => isWrittenAs(identifier, query)),
  );
  if (byIdentifier.length > 0) return byIdentifier;
  const words = nameTokens(query);
  if (words.length === 0) return [];
  return subjects.filter((subject) =>
    namesOf(subject).some((name) => {
      const tokens = nameTokens(name);
      return words.every((word) => tokens.some((token) => token.startsWith(word)));
    }),
  );
};

const toRef = ({ id, kind, canonicalName }: Subject) => ({ id, kind, name: canonicalName });

// A subject a reader may see: one a visible document concerns, and, unless the reader
// asked for private documents, one a public document has named.
const shownTo =
  (visible: ReadonlySet<string>, includePrivate: boolean) =>
  (subject: Subject): boolean =>
    visible.has(subject.id) && (includePrivate || !subject.private);

const findByQuery = async (
  db: Database,
  query: string,
  includePrivate: boolean,
): Promise<readonly Subject[]> => {
  const visible = await visibleSubjectIds(db, includePrivate);
  return designatedBy((await loadSubjects(db)).filter(shownTo(visible, includePrivate)), query);
};

// An id that is not well-formed names no subject, and is never sent to the database.
const findById = async (
  db: Database,
  id: string,
  includePrivate: boolean,
): Promise<readonly Subject[]> => {
  const subject = isId(ID_PREFIXES.subject, id) ? await findSubjectById(db, id) : undefined;
  if (subject === undefined) return [];
  const visible = await visibleSubjectIds(db, includePrivate, [id]);
  return shownTo(visible, includePrivate)(subject) ? [subject] : [];
};

/**
 * A subject with the documents that concern it, its current state and its next dates.
 * A query that names one subject answers like its id; one that names none, or several,
 * answers with the subjects it may have meant and no details. A subject that no visible
 * document concerns is not found: all that is known of it came from documents the caller
 * may not see.
 */
export const getSubject = async (
  { db }: KnowledgeReadContext,
  input: GetSubjectInput,
): Promise<GetSubjectOutput> => {
  const { id, query, asOf, includePrivate } = getSubjectInputSchema.parse(input);
  const designated =
    id === undefined
      ? await findByQuery(db, query ?? '', includePrivate)
      : await findById(db, id, includePrivate);
  const [found] = designated;
  if (found === undefined || designated.length > 1) {
    return { found: false, suggestions: designated.slice(0, MAX_SUBJECT_SUGGESTIONS).map(toRef) };
  }
  const visible = visibleDocument(includePrivate);
  const ofSubject = and(holdsId(documents.subjectIds, found.id), visible);
  const [listed, documentCount, states, next] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: docTypes.slug,
        date: statedDocumentDate,
        state: effectiveState,
      })
      .from(documents)
      .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
      .where(ofSubject)
      .orderBy(sql`${statedDocumentDate} DESC NULLS LAST`, desc(documents.id))
      .limit(MAX_SUBJECT_DOCUMENTS),
    db.$count(documents, ofSubject),
    readSubjectDocumentStates(db, found.id, visible),
    upcoming(
      { db },
      {
        from: asOf ?? today(),
        to: LAST_DAY,
        subject: found.id,
        includePrivate,
        limit: MAX_SUBJECT_NEXT_DATES,
      },
    ),
  ]);
  return {
    found: true,
    subject: {
      id: found.id,
      kind: found.kind,
      name: found.canonicalName,
      aliases: found.aliases,
      identifiers: found.identifiers.map(viewSubjectIdentifier),
    },
    state: deriveSubjectState(found.kind, states),
    documents: listed,
    documentCount,
    nextDates: next.dates,
  };
};
