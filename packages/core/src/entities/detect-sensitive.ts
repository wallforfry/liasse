import { isValidCardNumber } from './card-number.ts';
import { ibanLengthOf, isValidIban } from './iban.ts';
import { compactSensitive, maskOf, type SensitiveIdentifierType } from './sensitive.ts';

export interface SensitiveMatch {
  readonly type: SensitiveIdentifierType;
  // Offsets in the text given, `end` excluded.
  readonly start: number;
  readonly end: number;
  // As written in the text, separators included.
  readonly value: string;
}

const ALPHANUMERIC = '[A-Za-z0-9]';
const NOT_BEFORE = `(?<!${ALPHANUMERIC})`;
const NOT_AFTER = `(?!${ALPHANUMERIC})`;

// What stands between the groups of an IBAN: any white space (no-break and narrow
// no-break spaces, tabs and line breaks included), a dot or a dash, once or twice. A
// statement may break an IBAN across two lines.
const IBAN_SEPARATOR = '[\\s.-]{0,2}';

const IBAN_START = new RegExp(`${NOT_BEFORE}[A-Za-z]{2}\\d{2}`, 'g');

// The country gives the exact length, so the match never runs into the word that follows.
const ibanPattern = (length: number): RegExp =>
  new RegExp(
    `^${ALPHANUMERIC}(?:${IBAN_SEPARATOR}${ALPHANUMERIC}){${String(length - 1)}}${NOT_AFTER}`,
  );

const ibanAt = (text: string, start: number): readonly SensitiveMatch[] => {
  const length = ibanLengthOf(text.slice(start, start + 2).toUpperCase());
  const value = length === undefined ? undefined : ibanPattern(length).exec(text.slice(start))?.[0];
  return value !== undefined && isValidIban(compactSensitive('iban', value))
    ? [{ type: 'iban', start, end: start + value.length, value }]
    : [];
};

const findIbans = (text: string): readonly SensitiveMatch[] =>
  [...text.matchAll(IBAN_START)].flatMap(({ index }) => ibanAt(text, index));

// What stands between the groups of a card number, the same all along one number: one or
// two spaces of any kind on the line, a dot or a dash.
const CARD_SEPARATOR = '([^\\S\\r\\n]{1,2}|[.-])';

const digits = (count: number): string => `\\d{${String(count)}}`;

// The separator is captured after the first group and must be the one after each other.
const grouped = ([first = 0, ...rest]: readonly number[]): string =>
  [
    digits(first),
    ...rest.map((size, index) => (index === 0 ? CARD_SEPARATOR : '\\1') + digits(size)),
  ].join('');

// The ways a card number is printed: in the groups of its network, or unbroken. Digits
// that only add up to a card number across unrelated numbers are not one. The longest
// form comes first, so a longer number is not cut to a shorter one that starts it.
const CARD_FORMS: readonly RegExp[] = [
  grouped([4, 4, 4, 4, 3]),
  grouped([4, 4, 4, 4]),
  grouped([4, 6, 5]),
  '\\d{15,19}',
].map((form) => new RegExp(`${NOT_BEFORE}${form}${NOT_AFTER}`, 'g'));

const overlaps = (left: SensitiveMatch, right: SensitiveMatch): boolean =>
  left.start < right.end && right.start < left.end;

const cardsOfForm = (text: string, form: RegExp): readonly SensitiveMatch[] =>
  [...text.matchAll(form)].flatMap(({ 0: value, index }) =>
    isValidCardNumber(compactSensitive('card_number', value))
      ? [{ type: 'card_number', start: index, end: index + value.length, value }]
      : [],
  );

const findCardNumbers = (text: string): readonly SensitiveMatch[] =>
  CARD_FORMS.reduce<readonly SensitiveMatch[]>(
    (found, form) => [
      ...found,
      ...cardsOfForm(text, form).filter((match) => !found.some((kept) => overlaps(kept, match))),
    ],
    [],
  );

// The digits of an IBAN must not be read again as a card number.
const blankOut = (text: string, matches: readonly SensitiveMatch[]): string =>
  matches.reduce(
    (blanked, { start, end }) =>
      blanked.slice(0, start) + 'x'.repeat(end - start) + blanked.slice(end),
    text,
  );

// IBANs (country length and mod 97 check) and card numbers (issuer range, length, Luhn
// check and grouping) written in a text, in the order they appear.
export const findSensitiveIdentifiers = (text: string): readonly SensitiveMatch[] => {
  const ibans = findIbans(text);
  return [...ibans, ...findCardNumbers(blankOut(text, ibans))].toSorted(
    (left, right) => left.start - right.start,
  );
};

// The text with each IBAN and card number replaced by its mask.
export const redactSensitiveIdentifiers = (text: string): string =>
  findSensitiveIdentifiers(text).reduceRight(
    (redacted, { type, start, end, value }) =>
      redacted.slice(0, start) + maskOf(type, value) + redacted.slice(end),
    text,
  );
