import { createHash } from 'node:crypto';
import { DOCUMENTS_DIRECTORY, GROUND_TRUTH_FILE, QUESTIONS_FILE } from '../corpus.ts';
import { CORPUS_SEED } from '../identifiers.ts';
import { type RenderedDocument, renderDocument } from '../render/render-document.ts';
import {
  type Corpus,
  corpusSchema,
  type GroundTruth,
  type QuestionSet,
  questionSetSchema,
} from '../schema/index.ts';
import {
  entityTruths,
  OWNER,
  REFERENCE_DATE,
  SCENARIO,
  type ScenarioDocument,
  SUBJECTS,
} from '../scenario/index.ts';
import { QUESTIONS } from '../scenario/questions.ts';

export interface CorpusFile {
  // Relative to the root of the corpus, with forward slashes.
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface BuiltCorpus {
  readonly corpus: Corpus;
  readonly questions: QuestionSet;
  // Every file of the corpus: the documents, the ground truth and the questions.
  readonly files: readonly CorpusFile[];
}

interface Carrier {
  readonly email: string;
  readonly filename: string;
}

// The documents that travel inside an email, by id: they have no file of their own.
const carriers = (scenario: readonly ScenarioDocument[]): ReadonlyMap<string, Carrier> =>
  new Map(
    scenario.flatMap(({ id, render }) =>
      render.kind === 'eml'
        ? render.attachments.map(
            ({ document, filename }) => [document, { email: id, filename }] as const,
          )
        : [],
    ),
  );

const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

interface Progress {
  readonly rendered: ReadonlyMap<string, RenderedDocument>;
  readonly records: readonly GroundTruth[];
  readonly files: readonly CorpusFile[];
}

const FILE_NUMBER_DIGITS = 2;

const record = (
  document: ScenarioDocument,
  rendered: RenderedDocument,
  source: GroundTruth['source'],
): GroundTruth => ({
  id: document.id,
  description: document.description,
  source,
  mime: rendered.mime,
  sha256: sha256(rendered.bytes),
  size: rendered.bytes.length,
  ...document.truth,
  pages: [...rendered.pages],
});

// Renders the scenario into the files of the corpus and their ground truth. It reads no
// clock and no random source: the same scenario gives the same bytes. `heic` holds the
// HEIC files, the one format that cannot be encoded here (see `render-document.ts`).
export const buildCorpus = (heic: ReadonlyMap<string, Uint8Array>): BuiltCorpus => {
  const carriedBy = carriers(SCENARIO);
  const { records, files } = SCENARIO.reduce<Progress>(
    (progress, document) => {
      const rendered = renderDocument(document, { rendered: progress.rendered, heic });
      const carrier = carriedBy.get(document.id);
      const number = String(progress.files.length + 1).padStart(FILE_NUMBER_DIGITS, '0');
      const path = `${DOCUMENTS_DIRECTORY}/${number}-${document.id}.${rendered.extension}`;
      const source: GroundTruth['source'] =
        carrier === undefined
          ? { kind: 'file', path }
          : { kind: 'attachment', of: carrier.email, filename: carrier.filename };
      return {
        rendered: new Map([...progress.rendered, [document.id, rendered]]),
        records: [...progress.records, record(document, rendered, source)],
        files:
          carrier === undefined
            ? [...progress.files, { path, bytes: rendered.bytes }]
            : progress.files,
      };
    },
    { rendered: new Map(), records: [], files: [] },
  );
  const corpus = corpusSchema.parse({
    version: 1,
    seed: CORPUS_SEED,
    reference_date: REFERENCE_DATE,
    owner: OWNER,
    entities: entityTruths(),
    subjects: Object.values(SUBJECTS),
    documents: records,
  });
  const questions = questionSetSchema.parse({
    reference_date: REFERENCE_DATE,
    questions: QUESTIONS,
  });
  return {
    corpus,
    questions,
    files: [
      ...files,
      { path: GROUND_TRUTH_FILE, bytes: json(corpus) },
      { path: QUESTIONS_FILE, bytes: json(questions) },
    ],
  };
};
