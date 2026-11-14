import type { GroundTruth, SystemDocument } from '../schema/index.ts';
import { foldText } from './compare.ts';

export interface TranscriptionScore {
  readonly page: number;
  // Of the words the system transcribed, the share that is on the page.
  readonly precision: number;
  // Of the words on the page, the share the system transcribed.
  readonly recall: number;
  readonly f1: number;
}

// Words and numbers, without case, accents or punctuation: a transcription in Markdown
// (tables, headings, emphasis) is not held to the layout of the page.
const tokens = (text: string): readonly string[] => foldText(text).match(/[a-z0-9]+/g) ?? [];

const countByToken = (words: readonly string[]): ReadonlyMap<string, number> =>
  words.reduce(
    (counts, word) => counts.set(word, (counts.get(word) ?? 0) + 1),
    new Map<string, number>(),
  );

const share = (part: number, whole: number, whenEmpty: number): number =>
  whole === 0 ? whenEmpty : part / whole;

// Each word counts as many times as it appears on the page: repeating one does not help.
export const scoreTranscription = (
  expected: string,
  actual: string,
  page = 1,
): TranscriptionScore => {
  const truth = tokens(expected);
  const found = tokens(actual);
  const available = countByToken(truth);
  const common = [...countByToken(found)].reduce(
    (total, [word, count]) => total + Math.min(count, available.get(word) ?? 0),
    0,
  );
  const precision = share(common, found.length, truth.length === 0 ? 1 : 0);
  const recall = share(common, truth.length, 1);
  return { page, precision, recall, f1: share(2 * precision * recall, precision + recall, 0) };
};

// Scores the pages the truth says have no text layer; a page the system does not have
// counts as an empty transcription.
export const scoreTranscriptions = (
  truth: GroundTruth,
  output: SystemDocument,
): readonly TranscriptionScore[] =>
  truth.pages
    .filter(({ method }) => method === 'vision')
    .map(({ page, text }) =>
      scoreTranscription(
        text,
        output.pages.find((candidate) => candidate.page === page)?.text ?? '',
        page,
      ),
    );
