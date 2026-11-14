import {
  type Answer,
  type Corpus,
  type CoreTruth,
  type Expectation,
  type GroundTruth,
  type Question,
  type SystemDocument,
  systemDocumentSchema,
} from '../schema/index.ts';
import { type CorpusIndex, createCorpusIndex } from './corpus-index.ts';

const found = <Value>(expectation: Expectation<Value>): Value | undefined =>
  expectation.requirement === 'forbidden' ? undefined : expectation.value;

const nameOf = (key: string | undefined, index: CorpusIndex): string | undefined =>
  key === undefined ? undefined : index.entityNames(key)[0];

const oracleCore = (core: CoreTruth, index: CorpusIndex) => ({
  document_date: found(core.document_date),
  issuer: nameOf(found(core.issuer), index),
  recipient: nameOf(found(core.recipient), index),
  amount: found(core.amount),
  period: found(core.period),
  due_date: found(core.due_date),
  reference: found(core.reference),
  language: found(core.language),
});

// JSON drops the values that were not found, and the schema of a system output checks
// the rest: the oracle is held to the format a real run is.
const asSystemDocument = (document: unknown): SystemDocument =>
  systemDocumentSchema.parse(JSON.parse(JSON.stringify(document)));

// What a system that found everything, and nothing else, would hold for a document: every
// stated value under its preferred name, every sensitive identifier masked.
export const oracleDocument = (truth: GroundTruth, index: CorpusIndex): SystemDocument =>
  asSystemDocument({
    id: truth.id,
    duplicate_of: truth.duplicate_of,
    type: { slug: truth.type.category, parent_slug: truth.type.parent },
    core: oracleCore(truth.core, index),
    key_dates: truth.key_dates.flatMap(({ kinds: [kind = 'event'], expectation }) =>
      expectation.requirement === 'forbidden'
        ? []
        : [{ kind, date: expectation.value, label: 'stated by the document' }],
    ),
    fields: Object.fromEntries(
      truth.fields.flatMap(({ names: [name = ''], expectation, masked }) =>
        expectation.requirement === 'forbidden'
          ? []
          : [[name, masked ? `**** ${String(expectation.value)}` : expectation.value]],
      ),
    ),
    extra: {},
    provenance: {},
    title: truth.description,
    summary: null,
    links: truth.links
      .filter(({ requirement }) => requirement !== 'forbidden')
      .map(({ kind, target }) => ({ kind, target })),
    subjects: truth.subjects
      .filter(({ requirement }) => requirement !== 'forbidden')
      .map(({ subject }) => ({
        kind: index.subject(subject).kind,
        label: index.subject(subject).label,
      })),
    facts: truth.facts.map(({ statement, entities, subjects }) => ({
      text: statement,
      valid_from: null,
      valid_to: null,
      entities: entities.map((key) => index.entityNames(key)[0] ?? key),
      subjects: subjects.map((key) => index.subject(key).label),
    })),
    private: truth.private === 'required',
    pages: truth.pages,
  });

export const oracleDocuments = (corpus: Corpus): readonly SystemDocument[] => {
  const index = createCorpusIndex(corpus);
  return corpus.documents.map((truth) => oracleDocument(truth, index));
};

// The answer that states exactly what a question expects.
export const oracleAnswer = ({ expected }: Question, index: CorpusIndex): Answer => ({
  documents: [
    ...expected.documents.required,
    ...expected.documents.any_of.flatMap(([first]) => (first === undefined ? [] : [first])),
  ],
  amounts: expected.amounts.map(({ key, value }) => ({ key, value })),
  dates: expected.dates.map(({ key, date }) => ({ key, date })),
  counts: expected.counts.map(({ key, value }) => ({ key, value })),
  entities: expected.entities.required.map((key) => index.entityNames(key)[0] ?? key),
  verdict: expected.verdict,
});
