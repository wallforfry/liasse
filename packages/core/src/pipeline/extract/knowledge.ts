import {
  MAX_FACTS_PER_DOCUMENT,
  MAX_KEY_DATES_PER_DOCUMENT,
  MAX_SUBJECTS_PER_DOCUMENT,
} from '../../domain/limits.ts';
import { keyDateSchema } from '../../domain/values.ts';
import { type KnowledgeInput, knowledgeKeyDateSchema } from '../../knowledge/input.ts';
import { KEY_DATES_FIELD } from '../../registry/core-fields.ts';
import { ownValue } from '../../registry/own.ts';
import type { ExtractionTrace } from './assemble.ts';
import { type EntityResolutions, mentionKey } from './entities.ts';
import {
  type ExtractedFact,
  type ExtractionOutput,
  factSchema,
  noticePeriodOutputSchema,
  type SubjectCandidate,
  subjectCandidateSchema,
} from './extraction-schema.ts';
import { statesDuration } from './quote-durations.ts';
import { compactIdentifier, factSupport, quoteSupports, type SupportedFact } from './support.ts';
import { type Evidence, isListReading, type Readings, type VerifiedValue } from './read-output.ts';

export type ReadFact = SupportedFact<ExtractedFact>;

export interface FactsReading {
  readonly facts: readonly ReadFact[];
  readonly rejected: number;
}

// The table refuses a validity that ends before it starts: such a fact is dropped
// rather than stored with half of what the model said.
const holdsTogether = ({ valid_from: from, valid_to: to }: ExtractedFact): boolean =>
  from === undefined || to === undefined || from <= to;

// A fact is sourced like a value: its quote must stand in the text and state what the
// fact asserts, and the page kept is the one the quote stands on.
export const readFacts = (
  output: ExtractionOutput,
  { quotes, language }: Evidence,
): FactsReading => {
  const returned = output.facts ?? [];
  const facts = returned
    .flatMap((raw) => factSchema.safeParse(raw).data ?? [])
    .filter(holdsTogether)
    .flatMap((fact) => {
      const page = quotes.locate(fact.quote, fact.page);
      const supported = page === undefined ? undefined : factSupport(fact, language);
      return supported === undefined || page === undefined ? [] : [{ ...supported, page }];
    })
    .slice(0, MAX_FACTS_PER_DOCUMENT);
  return { facts, rejected: returned.length - facts.length };
};

export const factEntityNames = ({ facts }: FactsReading): readonly string[] =>
  facts.flatMap(({ entities }) => entities ?? []);

type KeyDateInput = KnowledgeInput['keyDates'][number];
type FactInput = KnowledgeInput['facts'][number];
type SubjectInput = KnowledgeInput['subjects'][number];
type NoticePeriodInput = NonNullable<KnowledgeInput['noticePeriod']>;
type TraceInput = Pick<KeyDateInput, 'model' | 'schemaVersion' | 'page' | 'quote' | 'confidence'>;

export interface NoticePeriodReading {
  readonly noticePeriod: NoticePeriodInput | undefined;
  readonly rejected: number;
}

// The notice deadline is computed from the period: its quote must stand in the text and
// write its amount and its unit, or the deadline would be one the document never gave.
export const readNoticePeriod = (
  { notice_period: raw }: ExtractionOutput,
  { quotes }: Evidence,
): NoticePeriodReading => {
  if (raw === undefined) return { noticePeriod: undefined, rejected: 0 };
  const period = noticePeriodOutputSchema.safeParse(raw).data;
  const supported =
    period !== undefined &&
    quotes.locate(period.quote, period.page) !== undefined &&
    statesDuration(period.quote, period.amount, period.unit);
  return supported
    ? {
        noticePeriod: { amount: period.amount, unit: period.unit, confidence: period.confidence },
        rejected: 0,
      }
    : { noticePeriod: undefined, rejected: 1 };
};

export interface SubjectsReading {
  readonly subjects: readonly SubjectInput[];
  readonly rejected: number;
}

// A subject is named in its quote. Its identifier links it to the same subject in other
// documents, so one the text does not write is dropped, and the subject kept without it.
const toSubject = (
  { kind, name, identifier }: SubjectCandidate,
  compactText: string,
): SubjectInput => {
  const written = identifier === undefined ? '' : compactIdentifier(identifier);
  return {
    kind,
    name,
    ...(identifier !== undefined && written !== '' && compactText.includes(written)
      ? { identifier }
      : {}),
  };
};

export const readSubjects = (
  output: ExtractionOutput,
  { quotes }: Evidence,
  documentText: string,
): SubjectsReading => {
  const returned = output.subjects ?? [];
  const compactText = compactIdentifier(documentText);
  const quoted = returned
    .flatMap((raw) => subjectCandidateSchema.safeParse(raw).data ?? [])
    .filter(
      ({ name, quote, page }) =>
        quotes.locate(quote, page) !== undefined && quoteSupports('text', name, quote, undefined),
    )
    .slice(0, MAX_SUBJECTS_PER_DOCUMENT);
  const subjects = quoted.map((candidate) => toSubject(candidate, compactText));
  const identified = (list: readonly { readonly identifier?: string | undefined }[]) =>
    list.filter(({ identifier }) => identifier !== undefined).length;
  const unwritten = identified(quoted) - identified(subjects);
  return { subjects, rejected: returned.length - subjects.length + unwritten };
};

const traceOf = (
  { page, quote, confidence }: Pick<VerifiedValue, 'page' | 'quote' | 'confidence'>,
  { model, schemaVersion }: ExtractionTrace,
): TraceInput => ({ model, schemaVersion, page, quote, confidence });

const toFact = (
  fact: ExtractedFact,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): FactInput => ({
  text: fact.text,
  validFrom: fact.valid_from ?? null,
  validTo: fact.valid_to ?? null,
  entityIds: [
    ...new Set(
      (fact.entities ?? []).flatMap((name) => resolutions.get(mentionKey(name))?.entity_id ?? []),
    ),
  ],
  subjects: fact.subjects ?? [],
  ...traceOf(fact, trace),
});

// A key date is checked again against the knowledge layer, whose label is trimmed and
// bounded where the core field's is not.
const keyDatesOf = (core: Readings, trace: ExtractionTrace): readonly KeyDateInput[] => {
  const reading = ownValue(core, KEY_DATES_FIELD);
  if (reading === undefined || !isListReading(reading)) return [];
  return reading
    .flatMap((item) => {
      const keyDate = keyDateSchema.safeParse(item.value).data;
      return keyDate === undefined
        ? []
        : (knowledgeKeyDateSchema.safeParse({ ...keyDate, ...traceOf(item, trace) }).data ?? []);
    })
    .slice(0, MAX_KEY_DATES_PER_DOCUMENT);
};

/**
 * The knowledge section of the same call: key dates, facts, candidate subjects and the
 * notice period.
 */
export const toKnowledge = (
  core: Readings,
  facts: FactsReading,
  { subjects }: SubjectsReading,
  { noticePeriod }: NoticePeriodReading,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): KnowledgeInput => ({
  keyDates: keyDatesOf(core, trace),
  facts: facts.facts.map((fact) => toFact(fact, trace, resolutions)),
  subjects,
  ...(noticePeriod === undefined ? {} : { noticePeriod }),
});
