import { describe, expect, it } from 'vitest';
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
