import {
  keyDateSchema,
  type RejectionReason,
  MAX_FACTS_PER_DOCUMENT,
  MAX_KEY_DATES_PER_DOCUMENT,
  MAX_SUBJECTS_PER_DOCUMENT,
} from '@liasse/contract/domain';
import { KEY_DATES_FIELD, ownValue } from '@liasse/contract/registry';
import { type KnowledgeInput, knowledgeKeyDateSchema } from '../../knowledge/input.ts';
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
  readonly rejected: readonly RejectionReason[];
}

// The table refuses a validity that ends before it starts: such a fact is dropped
// rather than stored with half of what the model said.
const holdsTogether = ({ valid_from: from, valid_to: to }: ExtractedFact): boolean =>
  from === undefined || to === undefined || from <= to;

// A fact is sourced like a value: its quote must stand in the text and state what the
// fact asserts, and the page kept is the one the quote stands on.
const readFact = (raw: unknown, { quotes, language }: Evidence): ReadFact | RejectionReason => {
  const fact = factSchema.safeParse(raw).data;
  if (fact === undefined) return 'malformed';
  if (!holdsTogether(fact)) return 'invalid_value';
  const page = quotes.locate(fact.quote, fact.page);
  if (page === undefined) return 'quote_not_found';
  const supported = factSupport(fact, language);
  return supported === undefined ? 'quote_not_stating_value' : { ...supported, page };
};

const keptOrReasons = <Kept extends object>(
  results: readonly (Kept | RejectionReason)[],
  limit: number,
): { readonly kept: readonly Kept[]; readonly rejected: readonly RejectionReason[] } => {
  const kept = results.flatMap((result) => (typeof result === 'string' ? [] : [result]));
  return {
    kept: kept.slice(0, limit),
    rejected: [
      ...results.flatMap((result) => (typeof result === 'string' ? [result] : [])),
      ...kept.slice(limit).map((): RejectionReason => 'over_limit'),
    ],
  };
};

export const readFacts = (output: ExtractionOutput, evidence: Evidence): FactsReading => {
  const { kept, rejected } = keptOrReasons(
    (output.facts ?? []).map((raw) => readFact(raw, evidence)),
    MAX_FACTS_PER_DOCUMENT,
  );
  return { facts: kept, rejected };
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
  readonly rejected: readonly RejectionReason[];
}

const readPeriod = (raw: unknown, { quotes }: Evidence): NoticePeriodInput | RejectionReason => {
  const period = noticePeriodOutputSchema.safeParse(raw).data;
  if (period === undefined) return 'malformed';
  if (quotes.locate(period.quote, period.page) === undefined) return 'quote_not_found';
  return statesDuration(period.quote, period.amount, period.unit)
    ? { amount: period.amount, unit: period.unit, confidence: period.confidence }
    : 'quote_not_stating_value';
};

// The notice deadline is computed from the period: its quote must stand in the text and
// write its amount and its unit, or the deadline would be one the document never gave.
export const readNoticePeriod = (
  { notice_period: raw }: ExtractionOutput,
  evidence: Evidence,
): NoticePeriodReading => {
  if (raw === undefined) return { noticePeriod: undefined, rejected: [] };
  const period = readPeriod(raw, evidence);
  return typeof period === 'string'
    ? { noticePeriod: undefined, rejected: [period] }
    : { noticePeriod: period, rejected: [] };
};

export interface SubjectsReading {
  readonly subjects: readonly SubjectInput[];
  readonly rejected: readonly RejectionReason[];
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

const readCandidate = (raw: unknown, { quotes }: Evidence): SubjectCandidate | RejectionReason => {
  const candidate = subjectCandidateSchema.safeParse(raw).data;
  if (candidate === undefined) return 'malformed';
  const { name, quote, page } = candidate;
  if (quotes.locate(quote, page) === undefined) return 'quote_not_found';
  return quoteSupports('text', name, quote, undefined) ? candidate : 'quote_not_stating_value';
};

export const readSubjects = (
  output: ExtractionOutput,
  evidence: Evidence,
  documentText: string,
): SubjectsReading => {
  const compactText = compactIdentifier(documentText);
  const { kept: quoted, rejected } = keptOrReasons(
    (output.subjects ?? []).map((raw) => readCandidate(raw, evidence)),
    MAX_SUBJECTS_PER_DOCUMENT,
  );
  const subjects = quoted.map((candidate) => toSubject(candidate, compactText));
  const unwritten = quoted.filter(
    ({ identifier }, index) =>
      identifier !== undefined && subjects[index]?.identifier === undefined,
  );
  return {
    subjects,
    rejected: [...rejected, ...unwritten.map((): RejectionReason => 'identifier_not_in_text')],
  };
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
