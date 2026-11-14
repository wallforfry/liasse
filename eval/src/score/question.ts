import type { Answer, AnswerExpectation, Question } from '../schema/index.ts';
import { nameMatches, sameMoney } from './compare.ts';
import type { CorpusIndex } from './corpus-index.ts';

export interface AnswerScore {
  readonly id: string;
  readonly pass: boolean;
  // Why the answer fails, one line per unmet expectation; empty when it passes.
  readonly reasons: readonly string[];
}

const list = (ids: readonly string[]): string => ids.join(', ');

const documentReasons = (
  { required, any_of, optional, forbidden, exhaustive }: AnswerExpectation['documents'],
  cited: readonly string[],
): readonly string[] => {
  const missing = required.filter((id) => !cited.includes(id));
  const unmetGroups = any_of.filter((group) => !group.some((id) => cited.includes(id)));
  const unwanted = forbidden.filter((id) => cited.includes(id));
  const allowed = new Set([...required, ...any_of.flat(), ...optional]);
  const unexpected = exhaustive
    ? cited.filter((id) => !allowed.has(id) && !forbidden.includes(id))
    : [];
  return [
    ...(missing.length === 0 ? [] : [`does not cite ${list(missing)}`]),
    ...unmetGroups.map((group) => `cites none of ${list(group)}`),
    ...(unwanted.length === 0 ? [] : [`cites ${list(unwanted)}, which must stay out`]),
    ...(unexpected.length === 0
      ? []
      : [`cites ${list(unexpected)}, which the question does not call for`]),
  ];
};

const valueReasons = (
  { amounts, dates, counts, verdict }: AnswerExpectation,
  answer: Answer,
): readonly string[] => [
  ...amounts
    .filter(
      ({ value, tolerance }) => !answer.amounts.some((given) => sameMoney(value, given, tolerance)),
    )
    .map(({ label, value }) => `no amount of ${String(value.value)} ${value.currency} (${label})`),
  ...dates
    .filter(({ date }) => !answer.dates.includes(date))
    .map(({ label, date }) => `no date ${date} (${label})`),
  ...counts
    .filter(({ value }) => !answer.counts.includes(value))
    .map(({ label, value }) => `no count of ${String(value)} (${label})`),
  ...(verdict === null || verdict === answer.verdict
    ? []
    : [`answers ${String(answer.verdict)} where the answer is ${String(verdict)}`]),
];

const entityReasons = (
  entities: readonly string[],
  answer: Answer,
  index: CorpusIndex,
): readonly string[] =>
  entities
    .filter((key) => !answer.entities.some((name) => nameMatches(name, index.entityNames(key))))
    .map((key) => `does not name ${index.entityNames(key)[0] ?? key}`);

// An answer passes when it meets every expectation of the question. What it adds beyond
// them (another amount, another date) is not judged, except documents when the question
// lists them exhaustively.
export const scoreAnswer = (
  question: Question,
  answer: Answer,
  index: CorpusIndex,
): AnswerScore => {
  const reasons = [
    ...documentReasons(question.expected.documents, answer.documents),
    ...valueReasons(question.expected, answer),
    ...entityReasons(question.expected.entities, answer, index),
  ];
  return { id: question.id, pass: reasons.length === 0, reasons };
};
