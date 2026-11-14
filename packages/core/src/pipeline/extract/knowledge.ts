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
  subjectCandidateSchema,
} from './extraction-schema.ts';
import { factSupport, type SupportedFact } from './support.ts';
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

export const readNoticePeriod = ({ notice_period: raw }: ExtractionOutput): NoticePeriodReading => {
  const parsed = noticePeriodOutputSchema.safeParse(raw);
  return { noticePeriod: parsed.data, rejected: raw === undefined || parsed.success ? 0 : 1 };
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

const subjectsOf = (output: ExtractionOutput): readonly SubjectInput[] =>
  (output.subjects ?? [])
    .flatMap((raw) => subjectCandidateSchema.safeParse(raw).data ?? [])
    .slice(0, MAX_SUBJECTS_PER_DOCUMENT)
    .map(({ kind, name, identifier }) => ({
      kind,
      name,
      ...(identifier === undefined ? {} : { identifier }),
    }));

/**
 * The knowledge section of the same call: key dates, facts, candidate subjects and the
 * notice period.
 */
export const toKnowledge = (
  output: ExtractionOutput,
  core: Readings,
  facts: FactsReading,
  { noticePeriod }: NoticePeriodReading,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): KnowledgeInput => ({
  keyDates: keyDatesOf(core, trace),
  facts: facts.facts.map((fact) => toFact(fact, trace, resolutions)),
  subjects: subjectsOf(output),
  ...(noticePeriod === undefined ? {} : { noticePeriod }),
});
