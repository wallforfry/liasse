export {
  AMOUNT_TOLERANCE,
  compactIdentifier,
  foldText,
  isMasked,
  nameMatches,
  sameIdentifier,
  sameMoney,
  sameNumber,
  textCarries,
} from './compare.ts';
export {
  type CorpusIndex,
  createCorpusIndex,
  labelNamesSubject,
  UnknownKeyError,
} from './corpus-index.ts';
export {
  type DocumentScore,
  SCORED_SECTIONS,
  type ScoredSection,
  scoreDocument,
} from './document.ts';
export { factCarries } from './facts.ts';
export { TYPE_VERDICTS, type TypeVerdict, typeVerdict } from './knowledge.ts';
export type { MaskingResult } from './masking.ts';
export { type Judgement, type Outcome, OUTCOMES, type Tally, tally } from './outcome.ts';
export { type AnswerScore, scoreAnswer } from './question.ts';
export { aggregateReport, type EvaluationReport } from './report.ts';
export { scoreTranscription, type TranscriptionScore } from './transcription.ts';
