import type { Money } from '@liasse/core/domain';
import { dateForms, PRINT_LANGUAGES } from '../format.ts';
import type { FactTruth, GroundTruth, SystemDocument, SystemFact } from '../schema/index.ts';
import { compactIdentifier, foldText, nameMatches, sameNumber } from './compare.ts';
import { type CorpusIndex, labelNamesSubject } from './corpus-index.ts';
import { type Judgement, judgePresence } from './outcome.ts';

// Digits in groups of three behind a separator, or a plain run, with optional decimals.
const NUMBER = /\d{1,3}(?:[\u00a0\u202f ',.]\d{3})+(?:[,.]\d{1,2})?|\d+(?:[,.]\d+)?/g;

// A written number may use a comma or a point for its decimals and the other, or a
// space, between thousands. Both readings of its last separator are kept: "1,249" is
// 1249 in an English text and 1.249 in a French one.
const readings = (written: string): readonly number[] => {
  const digits = written.replace(/[\u00a0\u202f ']/g, '');
  const last = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  if (last === -1) return [Number(digits)];
  const whole = digits.replace(/[,.]/g, '');
  const decimals = digits.length - last - 1;
  return [Number(whole), Number(whole) / 10 ** decimals];
};

export const numbersIn = (text: string): readonly number[] =>
  (text.match(NUMBER) ?? []).flatMap(readings);

// The ISO form and the forms of the languages the corpus is written in.
const mentionsOf = (date: string): readonly string[] => [
  date,
  ...PRINT_LANGUAGES.flatMap((language) => dateForms(date, language)),
];

const carriesDate = ({ text, valid_from, valid_to }: SystemFact, date: string): boolean =>
  valid_from === date ||
  valid_to === date ||
  mentionsOf(date).some((mention) => foldText(text).includes(foldText(mention)));

const carriesAmount = ({ text }: SystemFact, { value }: Money): boolean =>
  numbersIn(text).some((number) => sameNumber(value, number));

const carriesEntity = (fact: SystemFact, key: string, index: CorpusIndex): boolean => {
  const names = index.entityNames(key);
  return (
    fact.entities.some((name) => nameMatches(name, names)) ||
    names.some((name) => foldText(fact.text).includes(foldText(name)))
  );
};

const carriesSubject = (fact: SystemFact, key: string, index: CorpusIndex): boolean => {
  const subject = index.subject(key);
  return (
    fact.subjects.some((label) => labelNamesSubject(label, subject)) ||
    subject.identifiers.some((identifier) =>
      compactIdentifier(fact.text).includes(compactIdentifier(identifier)),
    )
  );
};

// A fact of the system states a fact of the truth when it carries all of its substance:
// the wording, the language and whatever else the fact says are free.
export const factCarries = (fact: SystemFact, expected: FactTruth, index: CorpusIndex): boolean =>
  expected.entities.every((key) => carriesEntity(fact, key, index)) &&
  expected.subjects.every((key) => carriesSubject(fact, key, index)) &&
  expected.dates.every((date) => carriesDate(fact, date)) &&
  expected.amounts.every((amount) => carriesAmount(fact, amount));

export const scoreFacts = (
  truth: GroundTruth,
  output: SystemDocument,
  index: CorpusIndex,
): readonly Judgement[] =>
  truth.facts.map((expected) =>
    judgePresence(
      expected.statement,
      expected.requirement,
      output.facts.some((fact) => factCarries(fact, expected, index)),
    ),
  );
