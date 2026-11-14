import type { PageText } from '../token-budget.ts';

// A quote shorter than this is found on almost any page and proves nothing.
export const MIN_QUOTE_LENGTH = 3;

const SINGLE_QUOTES = /[‘’‚‛′ʼ´`]/gu;
const DOUBLE_QUOTES = /[“”„‟«»″]/gu;
const DASHES = /[‐-―−]/gu;

/**
 * What a quote and a page are compared as. A model copies a quote through its own
 * tokenizer and a renderer writes the page with the typography of the file, so the
 * differences that carry no meaning are removed from both: Unicode composition (NFC),
 * case, typographic quotes and dashes, and whitespace of any kind and length, a line
 * break included (a quote may run over the end of a line). Nothing else: no accent is
 * dropped, no character is skipped, no distance is tolerated.
 */
export const normalizeForQuote = (text: string): string =>
  text
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFC');

export interface QuoteIndex {
  /** The page the quote stands on, or undefined when no page holds it. */
  readonly locate: (quote: string, statedPage: number) => number | undefined;
}

// A model that reads a long document miscounts pages more often than it invents a
// quote. The quote is looked for on the page it names first, then on the others, the
// nearest first and the earlier of two at the same distance: the page that is recorded
// is the one the quote was found on, never the one that was claimed.
export const createQuoteIndex = (pages: readonly PageText[]): QuoteIndex => {
  const normalized = pages.map(({ page, text }) => ({ page, text: normalizeForQuote(text) }));
  return {
    locate: (quote, statedPage) => {
      const wanted = normalizeForQuote(quote);
      if (wanted.length < MIN_QUOTE_LENGTH) return undefined;
      return normalized
        .filter(({ text }) => text.includes(wanted))
        .map(({ page }) => page)
        .toSorted(
          (left, right) =>
            Math.abs(left - statedPage) - Math.abs(right - statedPage) || left - right,
        )[0];
    },
  };
};
