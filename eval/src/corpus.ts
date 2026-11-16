import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Corpus,
  corpusSchema,
  type GroundTruth,
  type QuestionSet,
  questionSetSchema,
} from './schema/index.ts';

// The committed corpus, usable as it is: nothing needs to be generated to read it.
export const CORPUS_DIRECTORY = fileURLToPath(new URL('../corpus', import.meta.url));

export const DOCUMENTS_DIRECTORY = 'documents';
export const GROUND_TRUTH_FILE = 'ground-truth.json';
export const QUESTIONS_FILE = 'questions.json';

const readJson = async (path: string): Promise<unknown> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  return parsed;
};

export const loadCorpus = async (directory = CORPUS_DIRECTORY): Promise<Corpus> =>
  corpusSchema.parse(await readJson(join(directory, GROUND_TRUTH_FILE)));

export const loadQuestions = async (directory = CORPUS_DIRECTORY): Promise<QuestionSet> =>
  questionSetSchema.parse(await readJson(join(directory, QUESTIONS_FILE)));

// The bytes to ingest for a document, or undefined for one that only exists as the
// attachment of an email: ingesting the email is what brings it in.
export const readDocumentFile = async (
  { source }: Pick<GroundTruth, 'source'>,
  directory = CORPUS_DIRECTORY,
): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  source.kind === 'file'
    ? Uint8Array.from(await readFile(join(directory, ...source.path.split('/'))))
    : undefined;
