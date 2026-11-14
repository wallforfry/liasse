import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { documents } from '../db/schema/documents.ts';
import { documentDates } from '../db/schema/knowledge.ts';
import { docTypes } from '../db/schema/registry.ts';
import {
  DEFAULT_UPCOMING_LIMIT,
  MAX_QUERY_IN_VALUES,
  MAX_SLUG_LENGTH,
  MAX_UPCOMING_LIMIT,
} from '../domain/limits.ts';
import { documentStateSchema, keyDateKindSchema } from '../domain/schemas.ts';
import { isoDateSchema } from '../domain/values.ts';
import { ofType } from '../search/filters.ts';
import type { KnowledgeReadContext } from './context.ts';
import {
  documentRefSchema,
  effectiveState,
  holdsId,
  loadSubjectRefs,
  subjectRefSchema,
  subjectRefsOf,
  untrustedText,
  visibleDocument,
} from './read-shared.ts';

export const upcomingInputSchema = z
  .strictObject({
    // The window, both days included.
    from: isoDateSchema,
    to: isoDateSchema,
    kinds: z.array(keyDateKindSchema).min(1).optional(),
    // Slugs or aliases of types; a merged type still names its documents, as in search.
    types: z
      .array(z.string().min(1).max(MAX_SLUG_LENGTH))
      .min(1)
      .max(MAX_QUERY_IN_VALUES)
      .optional(),
    // The id of a subject.
    subject: z.string().min(1).optional(),
    // Leaves out the dates of a superseded or terminated document.
    currentOnly: z.boolean().default(true),
    includePrivate: z.boolean().default(false),
    limit: z.int().min(1).max(MAX_UPCOMING_LIMIT).default(DEFAULT_UPCOMING_LIMIT),
  })
  .refine(({ from, to }) => from <= to, {
    path: ['to'],
    message: 'expected the end of the window on or after its start',
  });
export type UpcomingInput = z.input<typeof upcomingInputSchema>;

export const upcomingDateSchema = z.strictObject({
  date: isoDateSchema,
  kind: keyDateKindSchema,
  label: untrustedText,
  // True for a date Liasse computed, such as a notice deadline: no model wrote it.
  computed: z.boolean(),
  document: documentRefSchema,
  subjects: z.array(subjectRefSchema).readonly(),
  state: documentStateSchema,
});
export type UpcomingDate = z.output<typeof upcomingDateSchema>;

export const upcomingOutputSchema = z.strictObject({
  dates: z.array(upcomingDateSchema).readonly(),
  // True when the window holds more dates than the limit: narrow it, or raise the limit.
  truncated: z.boolean(),
});
export type Upcoming = z.output<typeof upcomingOutputSchema>;

const CURRENT = 'current';

/**
 * The key dates of a window, sorted by date, each with its label, its kind, its document
 * (id, title, type), the subjects the document concerns and the state of the document.
 * The dates of a superseded or terminated document, and of an amendment to one, are left
 * out unless `currentOnly` is false: a terminated contract has no deadline to come.
 */
export const upcoming = async (
  { db }: KnowledgeReadContext,
  input: UpcomingInput,
): Promise<Upcoming> => {
  const { from, to, kinds, types, subject, currentOnly, includePrivate, limit } =
    upcomingInputSchema.parse(input);
  const rows = await db
    .select({
      date: documentDates.date,
      kind: documentDates.kind,
      label: documentDates.label,
      model: documentDates.model,
      documentId: documents.id,
      title: documents.title,
      type: docTypes.slug,
      subjectIds: documents.subjectIds,
      state: effectiveState,
    })
    .from(documentDates)
    .innerJoin(documents, eq(documents.id, documentDates.documentId))
    .leftJoin(docTypes, eq(docTypes.id, documents.typeId))
    .where(
      and(
        gte(documentDates.date, from),
        lte(documentDates.date, to),
        visibleDocument(includePrivate),
        kinds === undefined ? undefined : inArray(documentDates.kind, kinds),
        types === undefined ? undefined : or(...types.map(ofType)),
        subject === undefined ? undefined : holdsId(documents.subjectIds, subject),
        currentOnly ? sql`${effectiveState} = ${CURRENT}` : undefined,
      ),
    )
    .orderBy(
      asc(documentDates.date),
      asc(documents.id),
      asc(documentDates.kind),
      asc(documentDates.id),
    )
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const subjects = await loadSubjectRefs(
    db,
    page.flatMap(({ subjectIds }) => subjectIds),
  );
  return {
    dates: page.map(({ date, kind, label, model, documentId, title, type, subjectIds, state }) => ({
      date,
      kind,
      label,
      computed: model === null,
      document: { id: documentId, title, type },
      subjects: subjectRefsOf(subjects, subjectIds),
      state,
    })),
    truncated: rows.length > limit,
  };
};
