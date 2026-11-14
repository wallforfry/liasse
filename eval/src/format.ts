// How the documents of the scenario print dates and amounts. The ground truth quotes the
// same strings, so a value and the words that carry it cannot drift apart.

// prettier-ignore
const MONTHS = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
} as const;

export type PrintLanguage = keyof typeof MONTHS;
export const PRINT_LANGUAGES: readonly PrintLanguage[] = ['fr', 'en', 'de', 'es'];

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const partsOf = (iso: string): DateParts => {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return { year, month, day };
};

const monthName = (language: PrintLanguage, month: number): string =>
  MONTHS[language][month - 1] ?? '';

const two = (value: number): string => String(value).padStart(2, '0');

// The written forms of a date in one language, the usual one first.
export const dateForms = (iso: string, language: PrintLanguage): readonly string[] => {
  const { year, month, day } = partsOf(iso);
  const name = monthName(language, month);
  const numeric = `${two(day)}/${two(month)}/${String(year)}`;
  switch (language) {
    case 'fr':
      return [`${day === 1 ? '1er' : String(day)} ${name} ${String(year)}`, numeric];
    case 'en':
      return [`${String(day)} ${name} ${String(year)}`, `${name} ${String(day)}, ${String(year)}`];
    case 'de':
      return [
        `${two(day)}.${two(month)}.${String(year)}`,
        `${String(day)}. ${name} ${String(year)}`,
      ];
    case 'es':
      return [`${String(day)} de ${name} de ${String(year)}`, numeric];
  }
};

const longDate =
  (language: PrintLanguage) =>
  (iso: string): string =>
    dateForms(iso, language)[0] ?? iso;

// May 1, 2025, as the United States write it.
export const usDate = (iso: string): string => dateForms(iso, 'en')[1] ?? iso;

export const frDate = longDate('fr');
export const enDate = longDate('en');
export const deDate = longDate('de');
export const esDate = longDate('es');

// 05/03/2025, as French, Spanish and British documents shorten a date.
export const shortDate = (iso: string): string => {
  const { year, month, day } = partsOf(iso);
  return `${two(day)}/${two(month)}/${String(year)}`;
};

const grouped = (integer: string, separator: string): string =>
  integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

const decimal = (value: number, thousands: string, point: string): string => {
  const [integer = '0', fraction = '00'] = value.toFixed(2).split('.');
  return `${grouped(integer, thousands)}${point}${fraction}`;
};

// 1 284,00 as France, Germany and Spain write an amount, with a plain space between
// thousands: the text layer of a PDF would turn any other space into this one anyway.
export const euroNumber = (value: number): string => decimal(value, ' ', ',');

// 1,249.00 as English-speaking countries write it.
export const englishNumber = (value: number): string => decimal(value, ',', '.');

export const eur = (value: number): string => `${euroNumber(value)} €`;

// Whole cents, so that the lines of a bill add up to its total exactly.
export const cents = (value: number): number => Math.round(value * 100);
export const fromCents = (value: number): number => value / 100;
