import { describe, expect, it } from 'vitest';
import { isConsistentWithQuote } from './consistency.ts';
import { createQuoteIndex, normalizeForQuote } from './quotes.ts';

const pages = (...texts: readonly string[]) =>
  createQuoteIndex(texts.map((text, index) => ({ page: index + 1, text })));

describe('normalizeForQuote', () => {
  it.each([
    ['whitespace of any kind, a line break included', 'Total TTC\n  84,20\t€', 'total ttc 84,20 €'],
    ['case', 'TOTAL Ttc', 'total ttc'],
    ['Unicode composition', 'Résumé', 'résumé'],
    ['typographic quotes', '« l’été » “ici”', '" l\'été " "ici"'],
    ['typographic dashes', '2026–2027 — n−o', '2026-2027 - n-o'],
  ])('removes the difference of %s', (_case, text, expected) => {
    expect(normalizeForQuote(text)).toBe(expected);
  });

  it('keeps accents and every other character', () => {
    expect(normalizeForQuote('été')).not.toBe(normalizeForQuote('ete'));
    expect(normalizeForQuote('84,20')).not.toBe(normalizeForQuote('84.20'));
  });
});

describe('locating a quote', () => {
  it('finds a quote on the page it names, across a line break', () => {
    expect(pages('Total TTC\n84,20 €', 'other').locate('total ttc 84,20 €', 1)).toBe(1);
  });

  it('answers the page the quote stands on when the stated page is wrong', () => {
    expect(pages('first', 'second page', 'third').locate('second page', 1)).toBe(2);
  });

  it('prefers the stated page, then the nearest, then the earlier of two', () => {
    const index = pages('same words', 'none', 'same words', 'none', 'same words');
    expect(index.locate('same words', 3)).toBe(3);
    expect(index.locate('same words', 4)).toBe(3);
    expect(index.locate('same words', 2)).toBe(1);
  });

  it('finds nothing for a quote that is in no page, even nearly', () => {
    const index = pages('Total TTC 84,20 €');
    expect(index.locate('Total TTC 84,21 €', 1)).toBeUndefined();
    expect(index.locate('Total  HT 84,20 €', 1)).toBeUndefined();
    expect(index.locate('Totale TTC', 1)).toBeUndefined();
  });

  it('takes the earlier of two pages at the same distance, in whatever order they are given', () => {
    const index = createQuoteIndex([
      { page: 3, text: 'same words' },
      { page: 1, text: 'same words' },
    ]);
    expect(index.locate('same words', 2)).toBe(1);
  });

  it('refuses a quote under three characters, which any page holds', () => {
    const index = pages('Total TTC 84,20 €');
    expect(index.locate('84', 1)).toBeUndefined();
    expect(index.locate(' 8 ', 1)).toBeUndefined();
    expect(index.locate('84,', 1)).toBe(1);
  });
});

describe('isConsistentWithQuote', () => {
  it.each([
    ['2026-10-03', 'dated 03/10/2026', true],
    ['2026-10-03', 'le 3 octobre 26', true],
    ['2026-10-03', 'dated 03/10/2025', false],
    ['2026-10-03', 'no digit at all', false],
    ['2026-10-03', 'ref 20261003', true],
    [{ start: '2026-09-01', end: '2026-09-30' }, 'September 2026', true],
    [{ start: '2025-12-01', end: '2026-01-31' }, 'December 2025', false],
    [{ kind: 'due', date: '2026-10-18', label: 'Payment' }, 'due 18/10/2026', true],
    [{ kind: 'due', date: '2026-10-18', label: 'Payment' }, 'due 18/10/2027', false],
    [{ value: 84.2, currency: 'EUR' }, 'Total 84,20 €', true],
    [{ value: 1234.5, currency: 'EUR' }, 'Total 1 234,50 €', true],
    [{ value: 1234.5, currency: 'USD' }, '$1,234.50', true],
    [{ value: -84.2, currency: 'EUR' }, 'Avoir 84,20 €', true],
    [{ value: 84.2, currency: 'EUR' }, 'Total 48,20 €', false],
    [{ value: 84.2, currency: 'EUR' }, 'Total to pay', false],
    [{ value: 1e21, currency: 'EUR' }, '1000000000000000000000', false],
    ['free text', 'anything', true],
    [42, 'forty-two', true],
  ])('%j quoted as %j: %s', (value, quote, expected) => {
    expect(isConsistentWithQuote(value, quote)).toBe(expected);
  });
});
