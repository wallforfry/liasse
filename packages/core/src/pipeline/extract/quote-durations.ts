import type { NoticePeriodUnit } from '../../domain/enums.ts';

// The words of a duration unit in the schema languages, in ASCII, singular and plural.
// prettier-ignore
const UNIT_WORDS: Readonly<Record<NoticePeriodUnit, readonly string[]>> = {
  days: ['day', 'days', 'jour', 'jours', 'tag', 'tage', 'tagen', 'tages', 'dia', 'dias', 'giorno', 'giorni'],
  weeks: ['week', 'weeks', 'semaine', 'semaines', 'woche', 'wochen', 'semana', 'semanas', 'settimana', 'settimane'],
  months: ['month', 'months', 'mois', 'monat', 'monate', 'monaten', 'monats', 'mes', 'meses', 'mese', 'mesi'],
};

// The amounts a notice period is written with in words, one to twelve, in the schema
// languages; a larger one is written in digits ("thirty (30) days" holds 30).
// prettier-ignore
const AMOUNT_WORDS: readonly (readonly string[])[] = [
  ['one', 'un', 'une', 'uno', 'una', 'ein', 'eine', 'einen', 'einem', 'eines', 'einer'],
  ['two', 'deux', 'zwei', 'dos', 'due'],
  ['three', 'trois', 'drei', 'tres', 'tre'],
  ['four', 'quatre', 'vier', 'cuatro', 'quattro'],
  ['five', 'cinq', 'funf', 'fuenf', 'cinco', 'cinque'],
  ['six', 'sechs', 'seis', 'sei'],
  ['seven', 'sept', 'sieben', 'siete', 'sette'],
  ['eight', 'huit', 'acht', 'ocho', 'otto'],
  ['nine', 'neuf', 'neun', 'nueve', 'nove'],
  ['ten', 'dix', 'zehn', 'diez', 'dieci'],
  ['eleven', 'onze', 'elf', 'once', 'undici'],
  ['twelve', 'douze', 'zwolf', 'zwoelf', 'doce', 'dodici'],
];

const amountOf = (word: string): number | undefined => {
  if (/^\d+$/.test(word)) return Number(word);
  const index = AMOUNT_WORDS.findIndex((words) => words.includes(word));
  return index === -1 ? undefined : index + 1;
};

const wordsOf = (text: string): readonly string[] =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');

/**
 * Whether `quote` writes a duration of `amount` `unit`, the amount right before its unit:
 * "2 months", "30-day", "trois (3) mois", "zwei Monate".
 */
export const statesDuration = (quote: string, amount: number, unit: NoticePeriodUnit): boolean => {
  const words = wordsOf(quote);
  return words.some(
    (word, index) => amountOf(word) === amount && UNIT_WORDS[unit].includes(words[index + 1] ?? ''),
  );
};
