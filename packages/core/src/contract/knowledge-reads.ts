import { z } from 'zod';
import {
  DEFAULT_RECALL_LIMIT,
  DEFAULT_TIMELINE_LIMIT,
  MAX_QUERY_STRING_LENGTH,
  MAX_RECALL_LIMIT,
  MAX_SUBJECT_NAME_LENGTH,
  MAX_TIMELINE_LIMIT,
} from '../domain/limits.ts';
import {
  documentStateSchema,
  subjectIdentifierTypeSchema,
  subjectKindSchema,
} from '../domain/schemas.ts';
import { isoDateSchema } from '../domain/values.ts';
import {
  documentRefSchema,
  subjectRefSchema,
  untrustedText,
  upcomingDateSchema,
} from './knowledge.ts';

// The inputs and answers of the knowledge reads that no route serves yet: `timeline`,
// `recall` and `get_subject` of MCP. The knowledge layer parses its input with the
// camelCase schemas; a transport takes the snake_case ones, whose fields are the same.
// The rules that tie two fields together (a subject or an entity, a window in order) are
// on the camelCase schemas only: the knowledge layer applies them to what it is given.

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

export const recallInputSchema = z.strictObject({
  query: z.string().max(MAX_QUERY_STRING_LENGTH),
  // Only the facts valid on that day.
  at: isoDateSchema.optional(),
  limit: z.int().min(1).max(MAX_RECALL_LIMIT).default(DEFAULT_RECALL_LIMIT),
  includePrivate: z.boolean().default(false),
});
export type RecallInput = z.input<typeof recallInputSchema>;

export const RECALL_MATCHES = ['direct', 'related'] as const;

export const recalledFactSchema = z.strictObject({
  id: z.string(),
  text: untrustedText,
  validFrom: isoDateSchema.nullable(),
  validTo: isoDateSchema.nullable(),
  // The document the fact was read in.
  documentId: z.string(),
  entityIds: z.array(z.string()).readonly(),
  subjectIds: z.array(z.string()).readonly(),
  // `direct` for a fact the query found, `related` for one that shares an entity or a
  // subject with such a fact.
  match: z.enum(RECALL_MATCHES),
});
export type RecalledFact = z.output<typeof recalledFactSchema>;

export const recallOutputSchema = z.strictObject({
  facts: z.array(recalledFactSchema).readonly(),
});
export type Recall = z.output<typeof recallOutputSchema>;

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

const PRIVATE_DESCRIPTION = 'Private documents are left out unless this is true.';

const { includePrivate: timelinePrivate, ...timelineFields } = timelineInputSchema.shape;
export const timelineOptionsSchema = z.strictObject({
  ...timelineFields,
  include_private: timelinePrivate.describe(PRIVATE_DESCRIPTION),
});
export type TimelineOptions = z.output<typeof timelineOptionsSchema>;

const { includePrivate: recallPrivate, ...recallFields } = recallInputSchema.shape;
export const recallOptionsSchema = z.strictObject({
  ...recallFields,
  include_private: recallPrivate.describe(PRIVATE_DESCRIPTION),
});
export type RecallOptions = z.output<typeof recallOptionsSchema>;

const { includePrivate: subjectPrivate, asOf, ...subjectFields } = getSubjectInputSchema.shape;
export const getSubjectOptionsSchema = z.strictObject({
  ...subjectFields,
  as_of: asOf,
  include_private: subjectPrivate.describe(PRIVATE_DESCRIPTION),
});
export type GetSubjectOptions = z.output<typeof getSubjectOptionsSchema>;
