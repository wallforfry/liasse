import { describe, expect, it } from 'vitest';
import type { Expectation } from '../schema/index.ts';
import {
  COMPARISONS,
  isMasked,
  nameMatches,
  sameIdentifier,
  sameMoney,
  textCarries,
} from './compare.ts';
import { numbersIn } from './facts.ts';
import { judgePresence, judgeValue, tally } from './outcome.ts';
import { scoreTranscription } from './transcription.ts';

const context = { namesOf: (name: string) => [name] };

describe('the tolerance rules', () => {
  it('compares amounts within half a cent and never across currencies', () => {
    expect(sameMoney({ value: 84.2, currency: 'EUR' }, { value: 84.204, currency: 'EUR' })).toBe(
      true,
    );
    expect(sameMoney({ value: 84.2, currency: 'EUR' }, { value: 84.21, currency: 'EUR' })).toBe(
      false,
    );
    expect(sameMoney({ value: 84.2, currency: 'EUR' }, { value: 84.2, currency: 'USD' })).toBe(
      false,
    );
  });

  it('compares identifiers whatever their spacing, punctuation and case', () => {
    expect(sameIdentifier('FR76 9999 9000 01', 'fr7699999000 01')).toBe(true);
    expect(sameIdentifier('SS-417-OU', 'SS 417 OU')).toBe(true);
    expect(sameIdentifier('SS-417-OU', 'SS-471-OU')).toBe(false);
  });

  it('compares names as entity resolution does', () => {
    expect(nameMatches('VOLTANEIGE ÉNERGIE S.A.S.', ['Voltaneige Energie'])).toBe(true);
    expect(nameMatches('Voltaneige', ['Voltaneige Energie', 'Voltaneige'])).toBe(true);
    expect(nameMatches('Brisevent', ['Voltaneige Energie'])).toBe(false);
  });

  it('accepts a text that carries the expected words', () => {
    expect(textCarries('Anselme Rouvière', 'Dr ANSELME ROUVIERE, médecin')).toBe(true);
    expect(textCarries('Anselme Rouvière', 'Dr Quivrenne')).toBe(false);
  });

  it.each([
    'non favorable',
    'NON-FAVORABLE',
    'pas favorable',
    'not favorable',
    'no favorable outcome',
    'sans favorable',
  ])('does not find favorable in "%s", where a negation stands before it', (actual) => {
    expect(textCarries('favorable', actual)).toBe(false);
  });

  it('finds a word whose negation is elsewhere in the text', () => {
    expect(textCarries('favorable', 'Résultat favorable, pas de contre-visite')).toBe(true);
  });

  it('finds a word whose negation ends the sentence before it', () => {
    expect(textCarries('favorable', 'Contre-visite : non. Favorable')).toBe(true);
  });

  it('does not find a word a negation reaches across a few words', () => {
    expect(textCarries('favorable', "L'avis n'est pas du tout favorable")).toBe(false);
  });

  it('finds a word a negation of the same sentence no longer reaches', () => {
    expect(textCarries('favorable', 'Aucun défaut majeur relevé avis favorable')).toBe(true);
  });

  it('accepts a masked identifier that keeps its tail and not the clear value', () => {
    expect(isMasked('FR** **** 9322', '9322', 'FR76 9999 9000 0193 22')).toBe(true);
    expect(isMasked('FR7699999000019322', '9322', 'FR76 9999 9000 0193 22')).toBe(false);
    expect(isMasked('**** 1111', '9322', 'FR76 9999 9000 0193 22')).toBe(false);
  });

  it.each([
    ['date', '2025-03-05', '2025-03-05', true],
    ['date', '2025-03-05', '2025-03-06', false],
    ['date', '2025-03-05', '05/03/2025', false],
    [
      'period',
      { start: '2025-01-01', end: '2025-02-28' },
      { start: '2025-01-01', end: '2025-02-28' },
      true,
    ],
    [
      'period',
      { start: '2025-01-01', end: '2025-02-28' },
      { start: '2025-01-01', end: '2025-03-01' },
      false,
    ],
    ['number', 268, 268.004, true],
    ['number', 268, '268', false],
    ['boolean', true, true, true],
    ['boolean', true, 'true', false],
    ['money', { value: 96, currency: 'USD' }, { value: 96, currency: 'USD' }, true],
    ['money', { value: 96, currency: 'USD' }, 96, false],
    ['entity', 'Voltaneige Energie', 'voltaneige énergie SAS', true],
  ] as const)('compares a %s: %j with %j', (primitive, expected, actual, same) => {
    expect(COMPARISONS[primitive](expected, actual, context)).toBe(same);
  });
});

describe('judgements', () => {
  const same = (expected: string, actual: unknown): boolean => expected === actual;
  const required: Expectation<string> = {
    requirement: 'required',
    value: 'a',
    quote: null,
    also: ['b'],
  };
  const optional: Expectation<string> = { requirement: 'optional', value: 'a', quote: null };
  const forbidden: Expectation<string> = { requirement: 'forbidden' };

  it.each([
    ['a required value found', required, 'a', 'correct'],
    ['a required value found as an alternative', required, 'b', 'correct'],
    ['a required value not found', required, undefined, 'missing'],
    ['a required value found different', required, 'c', 'wrong'],
    ['an optional value not found', optional, undefined, 'absent'],
    ['an optional value found different', optional, 'c', 'wrong'],
    ['a forbidden value not found', forbidden, undefined, 'absent'],
    ['a forbidden value found', forbidden, 'c', 'invented'],
  ] as const)('judges %s', (_, expectation, actual, outcome) => {
    expect(judgeValue('field', expectation, actual, same).outcome).toBe(outcome);
  });

  it('counts a wrong value against precision, and against recall only when required', () => {
    const judgements = [
      judgeValue('a', required, 'a', same),
      judgeValue('b', required, 'c', same),
      judgeValue('c', required, undefined, same),
      judgeValue('d', optional, 'c', same),
      judgeValue('e', optional, undefined, same),
      judgeValue('f', forbidden, 'c', same),
      judgePresence('g', 'required', true),
    ];
    expect(tally(judgements)).toEqual({
      correct: 2,
      missing: 1,
      wrong: 2,
      invented: 1,
      absent: 1,
      precision: 2 / 5,
      recall: 2 / 4,
    });
  });

  it('has no precision and no recall over nothing', () => {
    expect(tally([judgePresence('a', 'optional', false)])).toMatchObject({
      precision: null,
      recall: null,
    });
  });
});

describe('numbersIn', () => {
  it.each([
    ['1 284,00 €', 1284],
    ['GBP 1,249.00', 1249],
    ['payé 203.45, le 28 juillet', 203.45],
    ['4 850,00 F', 4850],
    ['96 USD', 96],
  ])('reads %s', (text, value) => {
    expect(numbersIn(text)).toContain(value);
  });

  it('does not glue a date to an amount', () => {
    expect(numbersIn('203.45 on 2025-07-28')).not.toContain(203.452025);
    expect(numbersIn('203.45 on 2025-07-28')).toEqual(
      expect.arrayContaining([203.45, 2025, 7, 28]),
    );
  });
});

describe('scoreTranscription', () => {
  const page = 'Total TTC : 61,15 €\nÀ payer avant le 23 avril 2025';

  it('gives a perfect score to the page itself, whatever the layout', () => {
    expect(
      scoreTranscription(page, '| **Total TTC** | 61,15 € |\n\nà payer avant le 23 AVRIL 2025'),
    ).toMatchObject({
      precision: 1,
      recall: 1,
      f1: 1,
    });
  });

  it('loses recall for a missing line and precision for an invented one', () => {
    const partial = scoreTranscription(page, 'Total TTC : 61,15 €');
    const padded = scoreTranscription(page, `${page}\nMerci de votre confiance`);
    expect(partial.precision).toBe(1);
    expect(partial.recall).toBeCloseTo(4 / 11);
    expect(padded.recall).toBe(1);
    expect(padded.precision).toBeCloseTo(11 / 15);
  });

  it('does not reward a word repeated beyond the page', () => {
    expect(scoreTranscription('total 12', 'total total total 12').precision).toBe(0.5);
  });

  it('scores an empty transcription of a written page as nothing', () => {
    expect(scoreTranscription(page, '')).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });

  it('scores an empty transcription of an empty page as perfect', () => {
    expect(scoreTranscription('', '')).toMatchObject({ precision: 1, recall: 1, f1: 1 });
  });
});
