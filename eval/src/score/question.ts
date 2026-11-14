import {
  type Answer,
  type AnswerExpectation,
  answerSchema,
  type Question,
} from '../schema/index.ts';
import { nameMatches, sameMoney } from './compare.ts';
import type { CorpusIndex } from './corpus-index.ts';
import { depthIssues, issuesOf } from './invalid.ts';

export interface AnswerScore {
  readonly id: string;
  readonly pass: boolean;
  // Why the answer fails, one line per unmet expectation; empty when it passes.
  readonly reasons: readonly string[];
}

const list = (ids: readonly string[]): string => ids.join(', ');

// How many unwanted documents a reason names: an answer that cites the whole corpus gets
// one readable line, not fifty ids.
const LISTED_DOCUMENTS = 5;

const cappedList = (ids: readonly string[]): string =>
  ids.length <= LISTED_DOCUMENTS
    ? list(ids)
    : `${list(ids.slice(0, LISTED_DOCUMENTS))} and ${String(ids.length - LISTED_DOCUMENTS)} more`;

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
    ...(unwanted.length === 0 ? [] : [`cites ${cappedList(unwanted)}, which must stay out`]),
    ...(unexpected.length === 0
      ? []
      : [`cites ${cappedList(unexpected)}, which the question does not call for`]),
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

// A question that lists its documents or its entities as an exact set asks for an exact
// answer: an amount, a date or a count filed under a key it does not have is then a
// claim the answer adds and must be held to. Elsewhere such a value is about another
// thing the question did not ask, and is left alone: the slots already bind each value
// the question asks for to its meaning.
const isExact = ({ documents, entities }: AnswerExpectation): boolean =>
  documents.exhaustive || entities.exhaustive;

const unaskedValueReasons = (expected: AnswerExpectation, answer: Answer): readonly string[] => {
  const unasked = (
    kind: string,
    slots: readonly { readonly key: string }[],
    given: readonly { readonly key: string }[],
  ): readonly string[] =>
    [...new Set(given.map(({ key }) => key))]
      .filter((key) => !slots.some((slot) => slot.key === key))
      .map((key) => `${key}: ${kind} the question does not ask for`);
  return [
    ...unasked('an amount', expected.amounts, answer.amounts),
    ...unasked('a date', expected.dates, answer.dates),
    ...unasked('a count', expected.counts, answer.counts),
  ];
};

// An answer passes when it meets every expectation of the question. Each expected value
// is read under the key of its slot, so a right number cannot stand for another thing.
// What the answer adds is judged where the question asks for an exact set: documents and
// entities marked `exhaustive`, any second value under the key of a slot, and, for such
// a question, any value under a key it does not have. An input that is not an answer
// fails with the reason, without throwing.
export const scoreAnswer = (
  question: Question,
  answer: unknown,
  index: CorpusIndex,
): AnswerScore => {
  const tooDeep = depthIssues(answer);
  const parsed = answerSchema.safeParse(tooDeep.length > 0 ? undefined : answer);
  if (!parsed.success) {
    const issues = tooDeep.length > 0 ? tooDeep : issuesOf(parsed.error);
    return {
      id: question.id,
      pass: false,
      reasons: issues.map((issue) => `invalid answer: ${issue}`),
    };
  }
  const reasons = [
    ...documentReasons(question.expected.documents, parsed.data.documents),
    ...valueReasons(question.expected, parsed.data),
    ...(isExact(question.expected) ? unaskedValueReasons(question.expected, parsed.data) : []),
    ...entityReasons(question.expected.entities, parsed.data.entities, index),
  ];
  return { id: question.id, pass: reasons.length === 0, reasons };
};
