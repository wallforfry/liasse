import { keyDateSchema } from '../../domain/values.ts';
import { KEY_DATES_FIELD } from '../../registry/core-fields.ts';
import { ownValue } from '../../registry/own.ts';
import type {
  Knowledge,
  KnowledgeFact,
  KnowledgeKeyDate,
  KnowledgeSubjectCandidate,
  KnowledgeTrace,
} from '../deps.ts';
import { MAX_FACTS } from '../prompts/extraction.ts';
import type { ExtractionTrace } from './assemble.ts';
import { type EntityResolutions, mentionKey } from './entities.ts';
import {
  type ExtractedFact,
  type ExtractionOutput,
  factSchema,
  subjectCandidateSchema,
} from './extraction-schema.ts';
import type { QuoteIndex } from './quotes.ts';
import { isListReading, type Readings, type VerifiedValue } from './read-output.ts';

export const MAX_SUBJECT_CANDIDATES = 10;

export interface FactsReading {
  readonly facts: readonly ExtractedFact[];
  readonly rejected: number;
}

// The table refuses a validity that ends before it starts: such a fact is dropped
// rather than stored with half of what the model said.
const holdsTogether = ({ valid_from: from, valid_to: to }: ExtractedFact): boolean =>
  from === undefined || to === undefined || from <= to;

// A fact is sourced like a value: its quote must stand in the text, and the page kept
// is the one it stands on.
export const readFacts = (output: ExtractionOutput, quotes: QuoteIndex): FactsReading => {
  const returned = output.facts ?? [];
  const facts = returned
    .flatMap((raw) => factSchema.safeParse(raw).data ?? [])
    .filter(holdsTogether)
    .flatMap((fact) => {
      const page = quotes.locate(fact.quote, fact.page);
      return page === undefined ? [] : [{ ...fact, page }];
    })
    .slice(0, MAX_FACTS);
  return { facts, rejected: returned.length - facts.length };
};

export const factEntityNames = ({ facts }: FactsReading): readonly string[] =>
  facts.flatMap(({ entities }) => entities ?? []);

const traceOf = (
  { page, quote, confidence }: Pick<VerifiedValue, 'page' | 'quote' | 'confidence'>,
  { model, schemaVersion }: ExtractionTrace,
): KnowledgeTrace => ({ model, schemaVersion, page, quote, confidence });

const toFact = (
  fact: ExtractedFact,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): KnowledgeFact => ({
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

const keyDatesOf = (core: Readings, trace: ExtractionTrace): readonly KnowledgeKeyDate[] => {
  const reading = ownValue(core, KEY_DATES_FIELD);
  if (reading === undefined || !isListReading(reading)) return [];
  return reading.flatMap((item) => {
    const keyDate = keyDateSchema.safeParse(item.value);
    return keyDate.success ? [{ ...keyDate.data, ...traceOf(item, trace) }] : [];
  });
};

const subjectsOf = (output: ExtractionOutput): readonly KnowledgeSubjectCandidate[] =>
  (output.subjects ?? [])
    .flatMap((raw) => subjectCandidateSchema.safeParse(raw).data ?? [])
    .slice(0, MAX_SUBJECT_CANDIDATES)
    .map(({ kind, name, identifier }) => ({
      kind,
      name,
      ...(identifier === undefined ? {} : { identifier }),
    }));

/** The knowledge section of the same call: key dates, facts and candidate subjects. */
export const toKnowledge = (
  output: ExtractionOutput,
  core: Readings,
  facts: FactsReading,
  trace: ExtractionTrace,
  resolutions: EntityResolutions,
): Knowledge => ({
  keyDates: keyDatesOf(core, trace),
  facts: facts.facts.map((fact) => toFact(fact, trace, resolutions)),
  subjects: subjectsOf(output),
});
