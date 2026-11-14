import type { Expectation, Requirement } from '../schema/index.ts';

// What the system did with one expected value:
// - `correct`: the value was expected and the system holds it;
// - `missing`: the value was required and the system holds nothing;
// - `wrong`: a value was expected and the system holds another one;
// - `invented`: nothing was to be found and the system holds a value;
// - `absent`: the system holds nothing where nothing was required.
export const OUTCOMES = ['correct', 'missing', 'wrong', 'invented', 'absent'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Judgement {
  // What was judged: a field name, a kind of date, a link, a subject, a fact.
  readonly item: string;
  readonly requirement: Requirement;
  readonly outcome: Outcome;
  // Something worth telling the reader of a report: the name a field was found under,
  // the value that was found instead.
  readonly note?: string;
}

const describe = (value: unknown): string => JSON.stringify(value);

// Judges the value the system holds (undefined for none) against an expectation.
export const judgeValue = <Value>(
  item: string,
  expectation: Expectation<Value>,
  actual: unknown,
  matches: (expected: Value, actual: unknown) => boolean,
): Judgement => {
  const { requirement } = expectation;
  if (expectation.requirement === 'forbidden') {
    return actual === undefined
      ? { item, requirement, outcome: 'absent' }
      : { item, requirement, outcome: 'invented', note: `found ${describe(actual)}` };
  }
  if (actual === undefined) {
    return { item, requirement, outcome: requirement === 'required' ? 'missing' : 'absent' };
  }
  const accepted = [expectation.value, ...(expectation.also ?? [])];
  return accepted.some((expected) => matches(expected, actual))
    ? { item, requirement, outcome: 'correct' }
    : {
        item,
        requirement,
        outcome: 'wrong',
        note: `expected ${describe(expectation.value)}, found ${describe(actual)}`,
      };
};

// Judges whether something that is either there or not (a link, a subject, a flag) is.
export const judgePresence = (
  item: string,
  requirement: Requirement,
  present: boolean,
): Judgement => {
  if (requirement === 'forbidden')
    return { item, requirement, outcome: present ? 'invented' : 'absent' };
  if (present) return { item, requirement, outcome: 'correct' };
  return { item, requirement, outcome: requirement === 'required' ? 'missing' : 'absent' };
};

export interface Tally {
  readonly correct: number;
  readonly missing: number;
  readonly wrong: number;
  readonly invented: number;
  readonly absent: number;
  // Of what the system held, the share that was right; null when it held nothing.
  readonly precision: number | null;
  // Of what was required or found, the share that was right; null when nothing was.
  readonly recall: number | null;
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

// Precision counts a wrong value and an invented one against the system. Recall counts a
// missing value and a wrong value that was required; an optional value the system did not
// look for costs nothing.
export const tally = (judgements: readonly Judgement[]): Tally => {
  const count = (outcome: Outcome): number =>
    judgements.filter((judgement) => judgement.outcome === outcome).length;
  const wrongRequired = judgements.filter(
    ({ outcome, requirement }) => outcome === 'wrong' && requirement === 'required',
  ).length;
  const correct = count('correct');
  return {
    correct,
    missing: count('missing'),
    wrong: count('wrong'),
    invented: count('invented'),
    absent: count('absent'),
    precision: ratio(correct, correct + count('wrong') + count('invented')),
    recall: ratio(correct, correct + count('missing') + wrongRequired),
  };
};
