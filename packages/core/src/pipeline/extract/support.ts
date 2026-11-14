import { z } from 'zod';
import { CURRENCY_CODES } from '../../domain/currencies.ts';
import { normalizeEntityName, significantWords } from '../../domain/entity-name.ts';
import { isoDateSchema } from '../../domain/values.ts';
import { dateParts, datesIn, type StatedDates } from './quote-dates.ts';
import { numbersIn, statesNumber } from './quote-numbers.ts';
import { normalizeForQuote } from './quotes.ts';

// A quote found in the text proves the text exists, not that the value was read in it.
// A value is kept only when its own quote states it, by the rule of its kind.
export const SUPPORT_KINDS = [
  'text',
  'identifier',
  'enum',
  'number',
  'money',
  'date',
  'period',
  'key_date',
  // A boolean, or the language of the document: nothing a quote could write.
  'unchecked',
] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

/** Case, spaces and separators say nothing about which identifier a value is. */
export const compactIdentifier = (text: string): string =>
  text
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const DOLLARS = CURRENCY_CODES.filter((code) => code.endsWith('D'));
const POUNDS = ['GBP', 'EGP', 'FKP', 'GIP', 'LBP', 'SHP', 'SSP', 'SYP'];

const SYMBOLS: readonly (readonly [RegExp, readonly string[]])[] = [
  [/€|\beuros?\b/i, ['EUR']],
  [/£/, POUNDS],
  [/\$/, DOLLARS],
  [/¥/, ['JPY', 'CNY']],
  [/₹/, ['INR']],
  [/₩/, ['KRW']],
  [/₽/, ['RUB']],
  [/₺/, ['TRY']],
  [/₪/, ['ILS']],
];

const KNOWN_CODES: ReadonlySet<string> = new Set(CURRENCY_CODES);

// A code counts only next to a number: an invoice in capitals holds words such as ALL,
// CUP or TOP, which are codes too.
const CODE_NEAR_NUMBER = /\d[\d.,\s]*([A-Z]{3})(?![A-Za-z])|(?<![A-Za-z])([A-Z]{3})\s?-?\d/g;

/** The currencies `quote` writes, by code or by symbol; empty when it writes none. */
export const currenciesIn = (quote: string): ReadonlySet<string> =>
  new Set([
    ...[...quote.matchAll(CODE_NEAR_NUMBER)].flatMap(([, after, before]) =>
      [after, before].filter((code): code is string => code !== undefined && KNOWN_CODES.has(code)),
    ),
    ...SYMBOLS.flatMap(([symbol, codes]) => (symbol.test(quote) ? codes : [])),
  ]);

const holds = (quote: string, value: string): boolean => {
  const wanted = normalizeForQuote(value);
  return wanted !== '' && normalizeForQuote(quote).includes(wanted);
};

const holdsIdentifier = (quote: string, value: string): boolean => {
  const wanted = compactIdentifier(value);
  return wanted !== '' && compactIdentifier(quote).includes(wanted);
};

const moneyShape = z.object({ value: z.number(), currency: z.string() });
const periodShape = z.object({ start: isoDateSchema, end: isoDateSchema });
const keyDateShape = z.object({ date: isoDateSchema });

const supportsMoney = (value: unknown, quote: string): boolean => {
  const money = moneyShape.safeParse(value);
  if (!money.success || !statesNumber(numbersIn(quote), money.data.value)) return false;
  const stated = currenciesIn(quote);
  return stated.size === 0 || stated.has(money.data.currency);
};

const lastDayOf = (month: string): string => {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
};

// An end of a period is stated as a day, or as a whole month whose first (or last) day
// it is: "September 2026" states 2026-09-01 to 2026-09-30.
const statesStart = ({ days, months }: StatedDates, day: string): boolean =>
  days.has(day) || (day.endsWith('-01') && months.has(day.slice(0, 7)));

const statesEnd = ({ days, months }: StatedDates, day: string): boolean =>
  days.has(day) || (months.has(day.slice(0, 7)) && lastDayOf(day.slice(0, 7)) === day);

const supportsDate = (date: unknown, quote: string, language: string | undefined): boolean =>
  typeof date === 'string' && datesIn(quote, language).days.has(date);

const supportsPeriod = (value: unknown, quote: string, language: string | undefined) => {
  const period = periodShape.safeParse(value);
  if (!period.success) return false;
  const stated = datesIn(quote, language);
  return statesStart(stated, period.data.start) && statesEnd(stated, period.data.end);
};

const RULES: Readonly<
  Record<SupportKind, (value: unknown, quote: string, language: string | undefined) => boolean>
> = {
  text: (value, quote) => typeof value === 'string' && holds(quote, value),
  identifier: (value, quote) => typeof value === 'string' && holdsIdentifier(quote, value),
  enum: (value, quote) => typeof value === 'string' && holds(quote, value.replaceAll('_', ' ')),
  number: (value, quote) => typeof value === 'number' && statesNumber(numbersIn(quote), value),
  money: supportsMoney,
  date: supportsDate,
  period: supportsPeriod,
  key_date: (value, quote, language) =>
    supportsDate(keyDateShape.safeParse(value).data?.date, quote, language),
  unchecked: () => true,
};

/**
 * Whether `quote` states `value`, read as a value of `kind`. `language` is the ISO 639-1
 * code of the document: it decides how a numeric date is read.
 */
export const quoteSupports = (
  kind: SupportKind,
  value: unknown,
  quote: string,
  language: string | undefined,
): boolean => RULES[kind](value, quote, language);

// Below this, a quote is a word of the page: it cannot say what a fact asserts.
export const MIN_FACT_QUOTE_LENGTH = 12;

interface FactLike {
  readonly text: string;
  readonly quote: string;
  readonly entities?: readonly string[] | undefined;
  readonly valid_from?: string | undefined;
  readonly valid_to?: string | undefined;
}

// Inflections of one word share their beginning: "cancelled", "cancels", "cancellation".
const STEM_LENGTH = 5;

const wordsOf = (text: string): readonly string[] =>
  significantWords(normalizeEntityName(text)).map((word) => word.slice(0, STEM_LENGTH));

// A fact names no entity, date or number more often than not: what it says must then be
// in its quote. At least half of its words, and one at least: a single word in common
// ("customer") is found in any quote of the page it was taken from.
const sharesWords = (text: string, quote: string): boolean => {
  const said = [...new Set(wordsOf(text))];
  const quoted = new Set(wordsOf(quote));
  const found = said.filter((word) => quoted.has(word)).length;
  return found > 0 && found * 2 >= said.length;
};

const statesFact = (fact: FactLike, stated: StatedDates, language: string | undefined) => {
  const written = datesIn(fact.text, language);
  const months = new Set([...stated.months, ...[...stated.days].map((day) => day.slice(0, 7))]);
  const numbers = [...numbersIn(fact.quote), ...dateParts(stated)];
  return (
    normalizeForQuote(fact.quote).length >= MIN_FACT_QUOTE_LENGTH &&
    sharesWords(fact.text, fact.quote) &&
    (fact.entities ?? []).every((entity) => holds(fact.quote, entity)) &&
    [...written.days].every((day) => stated.days.has(day)) &&
    [...written.months].every((month) => months.has(month)) &&
    numbersIn(fact.text).every((number) => statesNumber(numbers, number))
  );
};

/**
 * The fact as its quote supports it: undefined when the quote is too short, or does not
 * name an entity, a date or a number the fact states. A validity its quote does not state
 * is taken off; the fact stays.
 */
export type SupportedFact<Fact extends FactLike> = Omit<Fact, 'valid_from' | 'valid_to'> & {
  readonly valid_from?: string;
  readonly valid_to?: string;
};

export const factSupport = <Fact extends FactLike>(
  fact: Fact,
  language: string | undefined,
): SupportedFact<Fact> | undefined => {
  const stated = datesIn(fact.quote, language);
  if (!statesFact(fact, stated, language)) return undefined;
  const { valid_from: from, valid_to: to, ...rest } = fact;
  return {
    ...rest,
    ...(from !== undefined && statesStart(stated, from) ? { valid_from: from } : {}),
    ...(to !== undefined && statesEnd(stated, to) ? { valid_to: to } : {}),
  };
};
