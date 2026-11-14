import {
  entityNameKey,
  isoDateSchema,
  type Money,
  moneySchema,
  periodSchema,
} from '@liasse/core/domain';
import type { TruthPrimitive } from '../schema/index.ts';

// The tolerance rules of the evaluation set, in one place:
// - dates, periods, booleans and languages compare exactly;
// - identifiers compare exactly once spaces, punctuation and case are set aside, since
//   the same IBAN is printed in groups of four or in one run;
// - amounts and numbers compare within half a cent, and an amount needs its currency;
// - names compare as entity resolution does: without case, accents or legal form;
// - free text must carry the expected words, whole and in order, whatever surrounds them.
export const AMOUNT_TOLERANCE = 0.005;

// Lowercase, without accents, with single spaces.
export const foldText = (text: string): string =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

// The letters and digits of an identifier, lowercase.
export const compactIdentifier = (text: string): string => foldText(text).replace(/[^a-z0-9]/g, '');

export const sameNumber = (expected: number, actual: number, tolerance = AMOUNT_TOLERANCE) =>
  Math.abs(expected - actual) <= tolerance;

export const sameMoney = (expected: Money, actual: Money, tolerance = AMOUNT_TOLERANCE) =>
  expected.currency === actual.currency && sameNumber(expected.value, actual.value, tolerance);

export const sameIdentifier = (expected: string, actual: string): boolean =>
  compactIdentifier(expected) === compactIdentifier(actual);

// True when the name the system gives is one of the names the entity goes by.
export const nameMatches = (actual: string, accepted: readonly string[]): boolean =>
  accepted.some((name) => entityNameKey(name) === entityNameKey(actual));

const wordsOf = (text: string): readonly string[] => foldText(text).match(/[a-z0-9]+/g) ?? [];

// The expected words, in order and whole: "favorable" is not in "defavorable".
export const textCarries = (expected: string, actual: string): boolean => {
  const wanted = wordsOf(expected);
  const given = wordsOf(actual);
  return (
    wanted.length > 0 &&
    given.some((_, start) => wanted.every((word, offset) => given[start + offset] === word))
  );
};

// A masked identifier keeps its last characters and never the clear value.
export const isMasked = (actual: string, visibleTail: string, clear: string): boolean =>
  compactIdentifier(actual).endsWith(compactIdentifier(visibleTail)) &&
  !compactIdentifier(actual).includes(compactIdentifier(clear));

export interface CompareContext {
  // The names an entity value may be given under: those of the entity of the corpus
  // that goes by this name, or the name alone when the corpus has no such entity.
  readonly namesOf: (name: string) => readonly string[];
}

type Comparison = (expected: unknown, actual: unknown, context: CompareContext) => boolean;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const both =
  <Value>(
    parse: (value: unknown) => Value | undefined,
    same: (expected: Value, actual: Value, context: CompareContext) => boolean,
  ): Comparison =>
  (expected, actual, context) => {
    const [left, right] = [parse(expected), parse(actual)];
    return left !== undefined && right !== undefined && same(left, right, context);
  };

const parsedBy =
  <Value>(schema: { safeParse: (value: unknown) => { success: boolean; data?: Value } }) =>
  (value: unknown): Value | undefined => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

// How a value of each primitive of the truth compares with what the system stored.
export const COMPARISONS: Readonly<Record<TruthPrimitive, Comparison>> = {
  text: both(text, textCarries),
  identifier: both(text, sameIdentifier),
  entity: both(text, (expected, actual, { namesOf }) => nameMatches(actual, namesOf(expected))),
  number: both(
    (value) => (typeof value === 'number' ? value : undefined),
    (expected, actual) => sameNumber(expected, actual),
  ),
  boolean: both(
    (value) => (typeof value === 'boolean' ? value : undefined),
    (expected, actual) => expected === actual,
  ),
  date: both(parsedBy(isoDateSchema), (expected, actual) => expected === actual),
  period: both(
    parsedBy(periodSchema),
    (expected, actual) => expected.start === actual.start && expected.end === actual.end,
  ),
  money: both(parsedBy(moneySchema), (expected, actual) => sameMoney(expected, actual)),
};
