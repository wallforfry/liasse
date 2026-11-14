import type { GroundTruth, SystemDocument } from '../schema/index.ts';
import type { CorpusIndex } from './corpus-index.ts';
import { scoreFacts } from './facts.ts';
import { scoreCore, scoreTypeFields } from './fields.ts';
import {
  scoreKeyDates,
  scoreLinks,
  scorePrivacy,
  scoreSubjects,
  typeVerdict,
  type TypeVerdict,
} from './knowledge.ts';
import { type MaskingResult, scoreMasking } from './masking.ts';
import { type Judgement, judgePresence } from './outcome.ts';
import { scoreTranscriptions, type TranscriptionScore } from './transcription.ts';

// The parts of a document that are judged value by value.
export const SCORED_SECTIONS = [
  'core',
  'fields',
  'key_dates',
  'links',
  'subjects',
  'facts',
] as const;
export type ScoredSection = (typeof SCORED_SECTIONS)[number];

export interface DocumentScore extends Readonly<Record<ScoredSection, readonly Judgement[]>> {
  readonly id: string;
  // Whether ingestion recognised a file with the bytes of another document, and only then.
  readonly duplicate: Judgement;
  // Null for a byte-identical copy: nothing but its recognition is scored.
  readonly type: TypeVerdict | null;
  readonly private: Judgement | null;
  readonly masking: readonly MaskingResult[];
  readonly transcription: readonly TranscriptionScore[];
}

const EMPTY_SECTIONS = { core: [], fields: [], key_dates: [], links: [], subjects: [], facts: [] };

const scoreDuplicate = (truth: GroundTruth, output: SystemDocument): Judgement => {
  const item = `duplicate of ${truth.duplicate_of ?? output.duplicate_of ?? 'nothing'}`;
  return truth.duplicate_of === null
    ? judgePresence(item, 'forbidden', output.duplicate_of !== null)
    : judgePresence(item, 'required', output.duplicate_of === truth.duplicate_of);
};

// Compares what the system derived from one document with its ground truth. Pure: it
// reads the two records and the corpus they belong to, nothing else.
export const scoreDocument = (
  truth: GroundTruth,
  output: SystemDocument,
  index: CorpusIndex,
): DocumentScore => {
  const duplicate = scoreDuplicate(truth, output);
  if (truth.duplicate_of !== null) {
    return {
      id: truth.id,
      duplicate,
      type: null,
      private: null,
      masking: [],
      transcription: [],
      ...EMPTY_SECTIONS,
    };
  }
  return {
    id: truth.id,
    duplicate,
    type: typeVerdict(truth.type, output.type),
    core: scoreCore(truth.core, output.core, index),
    fields: scoreTypeFields(truth, output, index),
    key_dates: scoreKeyDates(truth, output),
    links: scoreLinks(truth, output),
    subjects: scoreSubjects(truth, output, index),
    facts: scoreFacts(truth, output, index),
    private: scorePrivacy(truth, output),
    masking: scoreMasking(truth, output),
    transcription: scoreTranscriptions(truth, output),
  };
};
