import { z } from 'zod';
import { isoDateSchema } from '../../domain/values.ts';

// A quote that is in the document proves that the text exists, not that the value was
// read from it. Two kinds of value can be checked against their own quote at no cost,
// and are the ones a wrong figure hurts most: a date and an amount. The rest (names,
// free text, numbers a document may spell out) is not checked.

const digitGroups = (quote: string): readonly string[] => quote.match(/\d+/g) ?? [];

// The year is the part of a date every notation writes in digits: in full, or as its
// last two. A month may be a word in any language and a day may be absent ("October
// 2026"), so neither is required.
const quoteStatesYear = (date: string, quote: string): boolean => {
  const year = date.slice(0, 4);
  return digitGroups(quote).some((group) => group.includes(year) || group === year.slice(2));
};

// Thousands separators and the decimal mark differ between countries, so the digits
// are compared without them: 1234.5 is in "1 234,50" as 12345.
const quoteStatesAmount = (amount: number, quote: string): boolean => {
  const written = String(Math.abs(amount));
  return (
    /^\d+(\.\d+)?$/.test(written) && digitGroups(quote).join('').includes(written.replace('.', ''))
  );
};

const dated = z.object({ date: isoDateSchema });
const period = z.object({ start: isoDateSchema, end: isoDateSchema });
const money = z.object({ value: z.number(), currency: z.string() });

/** False for a date whose year, or an amount whose digits, its own quote does not hold. */
export const isConsistentWithQuote = (value: unknown, quote: string): boolean => {
  const date = isoDateSchema.safeParse(value);
  if (date.success) return quoteStatesYear(date.data, quote);
  const keyDate = dated.safeParse(value);
  if (keyDate.success) return quoteStatesYear(keyDate.data.date, quote);
  const span = period.safeParse(value);
  if (span.success) {
    return quoteStatesYear(span.data.start, quote) && quoteStatesYear(span.data.end, quote);
  }
  const amount = money.safeParse(value);
  return !amount.success || quoteStatesAmount(amount.data.value, quote);
};
