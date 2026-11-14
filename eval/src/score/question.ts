import {
  type Answer,
  type AnswerExpectation,
  answerSchema,
  type Question,
} from '../schema/index.ts';
import { nameMatches, sameMoney } from './compare.ts';
import type { CorpusIndex } from './corpus-index.ts';
import { issuesOf } from './invalid.ts';

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

interface Slot {
  readonly key: string;
  readonly label: string;
}

// Judges the values an answer files under the key of one slot. None is a missing value;
// one that differs is a wrong value, and so is a second one that contradicts a right one:
// an answer that gives both the right total and a wrong one has not answered.
const slotReasons = <Expected extends Slot, Given extends { readonly key: string }>(
  kind: string,
  expected: readonly Expected[],
  given: readonly Given[],
  matches: (expected: Expected, given: Given) => boolean,
  describe: (value: Expected | Given) => string,
): readonly string[] =>
  expected.flatMap((slot) => {
    const filed = given.filter(({ key }) => key === slot.key);
    if (filed.length === 0) return [`${slot.key}: no ${kind} (${slot.label})`];
    return filed
      .filter((value) => !matches(slot, value))
      .map((value) => `${slot.key}: ${describe(value)} is not ${describe(slot)} (${slot.label})`);
  });

const valueReasons = (
  { amounts, dates, counts, verdict }: AnswerExpectation,
  answer: Answer,
): readonly string[] => [
  ...slotReasons(
    'amount',
    amounts,
    answer.amounts,
    (expected, given) => sameMoney(expected.value, given.value, expected.tolerance),
    ({ value }) => `${String(value.value)} ${value.currency}`,
  ),
  ...slotReasons(
    'date',
    dates,
    answer.dates,
    (expected, given) => expected.date === given.date,
    ({ date }) => date,
  ),
  ...slotReasons(
    'count',
    counts,
    answer.counts,
    (expected, given) => expected.value === given.value,
    ({ value }) => String(value),
  ),
  ...(verdict === null || verdict === answer.verdict
    ? []
    : [`answers ${String(answer.verdict)} where the answer is ${String(verdict)}`]),
];

const entityReasons = (
  { required, exhaustive }: AnswerExpectation['entities'],
  named: readonly string[],
  index: CorpusIndex,
): readonly string[] => {
  const names = (key: string): readonly string[] => index.entityNames(key);
  const unnamed = required.filter((key) => !named.some((name) => nameMatches(name, names(key))));
  const uncalled = exhaustive
    ? named.filter((name) => !required.some((key) => nameMatches(name, names(key))))
    : [];
  return [
    ...unnamed.map((key) => `does not name ${names(key)[0] ?? key}`),
    ...uncalled.map((name) => `names ${name}, which the question does not call for`),
  ];
};

// An answer passes when it meets every expectation of the question. Each expected value
// is read under the key of its slot, so a right number cannot stand for another thing.
// What the answer adds is judged where the question asks for an exact set: documents and
// entities marked `exhaustive`, and any second value under the key of a slot. Values
// under keys the question does not have are left alone. An input that is not an answer
// fails with the reason, without throwing.
export const scoreAnswer = (
  question: Question,
  answer: unknown,
  index: CorpusIndex,
): AnswerScore => {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) {
    return {
      id: question.id,
      pass: false,
      reasons: issuesOf(parsed.error).map((issue) => `invalid answer: ${issue}`),
    };
  }
  const reasons = [
    ...documentReasons(question.expected.documents, parsed.data.documents),
    ...valueReasons(question.expected, parsed.data),
    ...entityReasons(question.expected.entities, parsed.data.entities, index),
  ];
  return { id: question.id, pass: reasons.length === 0, reasons };
};
