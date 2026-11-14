// The months in the schema languages, in ASCII, in calendar order. `MONTH_WORDS` of the
// registry is a list of words a slug may not hold, in no order: it cannot tell which
// month a word is.
// prettier-ignore
const MONTH_NAMES: readonly (readonly string[])[] = [
  ['january', 'janvier', 'januar', 'enero', 'gennaio'],
  ['february', 'fevrier', 'februar', 'febrero', 'febbraio'],
  ['march', 'mars', 'marz', 'maerz', 'marzo'],
  ['april', 'avril', 'abril', 'aprile'],
  ['may', 'mai', 'mayo', 'maggio'],
  ['june', 'juin', 'juni', 'junio', 'giugno'],
  ['july', 'juillet', 'juli', 'julio', 'luglio'],
  ['august', 'aout', 'agosto'],
  ['september', 'septembre', 'septiembre', 'setiembre', 'settembre'],
  ['october', 'octobre', 'oktober', 'octubre', 'ottobre'],
  ['november', 'novembre', 'noviembre'],
  ['december', 'decembre', 'dezember', 'diciembre', 'dicembre'],
];

// Words between a day, its month and its year ("18 de octubre de 2026", "Oct. 18th"),
// and the ordinal endings of a day.
// prettier-ignore
const CONNECTORS: ReadonlySet<string> = new Set([
  'de', 'del', 'of', 'the', 'le', 'du', 'el', 'il', 'den', 'der',
  'st', 'nd', 'rd', 'th', 'er', 'eme', 'e', 'o', 'a',
]);

const MIN_ABBREVIATION = 3;

// A word names a month when it starts one of its names, and no name of another month.
const monthOf = (word: string): number | undefined => {
  if (word.length < MIN_ABBREVIATION) return undefined;
  const months = MONTH_NAMES.flatMap((names, index) =>
    names.some((name) => name.startsWith(word)) ? [index + 1] : [],
  );
  return months.length === 1 ? months[0] : undefined;
};

const pad = (value: number): string => String(value).padStart(2, '0');

const isoDay = (year: number, month: number, day: number): string | undefined => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year)}-${pad(month)}-${pad(day)}`
    : undefined;
};

// A year written with two digits may be of either of the last two centuries.
const yearsOf = (written: string): readonly number[] =>
  written.length === 4 ? [Number(written)] : [2000 + Number(written), 1900 + Number(written)];

export interface StatedDates {
  readonly days: ReadonlySet<string>;
  /** Months stated without a day, as `YYYY-MM`. */
  readonly months: ReadonlySet<string>;
}

const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‐-―−]/gu, '-');

// The order of day and month in a numeric date follows the language of the document.
// Every language but English writes the day first. English writes both, so a reading is
// taken only when the other one is no date, or the same one.
const numericReadings = (
  first: number,
  second: number,
  year: number,
  language: string | undefined,
): readonly (string | undefined)[] => {
  const dayFirst = isoDay(year, second, first);
  if (language !== undefined && language !== 'en') return [dayFirst];
  const monthFirst = isoDay(year, first, second);
  return dayFirst === undefined || monthFirst === undefined || dayFirst === monthFirst
    ? [dayFirst ?? monthFirst]
    : [];
};

const numericDays = (text: string, language: string | undefined): readonly string[] =>
  [
    ...[...text.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)].map(([, y, m, d]) =>
      isoDay(Number(y), Number(m), Number(d)),
    ),
    ...[
      ...text.matchAll(
        /(?<!\d)(?<!\d[./-])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)(?![./-]\d)/g,
      ),
    ].flatMap(([, a, b, y]) =>
      yearsOf(y ?? '').flatMap((year) => numericReadings(Number(a), Number(b), year, language)),
    ),
  ].filter((day) => day !== undefined);

const numericMonths = (text: string): readonly string[] =>
  [...text.matchAll(/(?<!\d)(?<!\d[./-])(\d{1,2})[-/.](\d{4})(?!\d)(?![./-]\d)/g)].flatMap(
    ([, m, y]) => (Number(m) >= 1 && Number(m) <= 12 ? [`${y ?? ''}-${pad(Number(m))}`] : []),
  );

const isDayToken = (token: string | undefined): token is string =>
  token !== undefined && /^\d{1,2}$/.test(token) && Number(token) >= 1 && Number(token) <= 31;

const isYearToken = (token: string | undefined): token is string =>
  token !== undefined && /^(\d{4}|\d{2})$/.test(token);

interface Written {
  readonly days: readonly string[];
  readonly months: readonly string[];
}

// "18 octobre 2026", "October 18, 2026", "1. März 2026", "September 2026".
const textualDates = (tokens: readonly string[]): Written => {
  const meaningful = tokens.filter((token) => !CONNECTORS.has(token));
  return meaningful.reduce<Written>(
    (found, token, index) => {
      const month = monthOf(token);
      if (month === undefined) return found;
      const before = meaningful[index - 1];
      const after = meaningful[index + 1];
      const day = isDayToken(before) ? before : isDayToken(after) ? after : undefined;
      const yearToken = meaningful[index + (day === after && day !== undefined ? 2 : 1)];
      if (!isYearToken(yearToken)) return found;
      const years = yearsOf(yearToken);
      return day === undefined
        ? {
            ...found,
            months: [...found.months, ...years.map((year) => `${String(year)}-${pad(month)}`)],
          }
        : {
            ...found,
            days: [
              ...found.days,
              ...years.flatMap((year) => isoDay(year, month, Number(day)) ?? []),
            ],
          };
    },
    { days: [], months: [] },
  );
};

/** The calendar days, and the months, that `text` states in any common notation. */
export const datesIn = (text: string, language: string | undefined): StatedDates => {
  const normalized = plain(text);
  const textual = textualDates(normalized.match(/\d+|[a-z]+/g) ?? []);
  return {
    days: new Set([...numericDays(normalized, language), ...textual.days]),
    months: new Set([...numericMonths(normalized), ...textual.months]),
  };
};

/** The numbers a date writes in words or digits: its year, month and day. */
export const dateParts = ({ days, months }: StatedDates): readonly number[] =>
  [...days, ...months].flatMap((date) => date.split('-').map(Number));
