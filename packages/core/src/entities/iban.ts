// Length of an IBAN per country, from the ISO 13616 registry. A country that is not
// listed has no IBAN, which is what keeps an arbitrary reference out of the detector.
// prettier-ignore
const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map([
  ['AD', 24], ['AE', 23], ['AL', 28], ['AT', 20], ['AZ', 28], ['BA', 20], ['BE', 16], ['BG', 22],
  ['BH', 22], ['BR', 29], ['BY', 28], ['CH', 21], ['CR', 22], ['CY', 28], ['CZ', 24], ['DE', 22],
  ['DK', 18], ['DO', 28], ['EE', 20], ['EG', 29], ['ES', 24], ['FI', 18], ['FO', 18], ['FR', 27],
  ['GB', 22], ['GE', 22], ['GI', 23], ['GL', 18], ['GR', 27], ['GT', 28], ['HR', 21], ['HU', 28],
  ['IE', 22], ['IL', 23], ['IQ', 23], ['IS', 26], ['IT', 27], ['JO', 30], ['KW', 30], ['KZ', 20],
  ['LB', 28], ['LC', 32], ['LI', 21], ['LT', 20], ['LU', 20], ['LV', 21], ['MC', 27], ['MD', 24],
  ['ME', 22], ['MK', 19], ['MR', 27], ['MT', 31], ['MU', 30], ['NL', 18], ['NO', 15], ['PK', 24],
  ['PL', 28], ['PS', 29], ['PT', 25], ['QA', 29], ['RO', 24], ['RS', 22], ['SA', 24], ['SC', 31],
  ['SE', 24], ['SI', 19], ['SK', 24], ['SM', 27], ['ST', 25], ['SV', 28], ['TL', 23], ['TN', 24],
  ['TR', 26], ['UA', 29], ['VA', 22], ['VG', 24], ['XK', 20],
]);

export const IBAN_PREFIX_LENGTH = 4;

// The length an IBAN must have, read from its first two letters.
export const ibanLengthOf = (prefix: string): number | undefined =>
  IBAN_LENGTHS.get(prefix.slice(0, 2));

const LETTER_OFFSET = 'A'.charCodeAt(0) - 10;

const digitsOf = (character: string): string =>
  character >= 'A' ? String(character.charCodeAt(0) - LETTER_OFFSET) : character;

// ISO 7064 mod 97-10, folded digit by digit so that no big integer is needed.
const mod97 = (digits: string): number =>
  Array.from(digits).reduce((remainder, digit) => (remainder * 10 + Number(digit)) % 97, 0);

// Takes an IBAN without separators, in upper case.
export const isValidIban = (compact: string): boolean =>
  /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact) &&
  compact.length === ibanLengthOf(compact) &&
  mod97(
    Array.from(
      compact.slice(IBAN_PREFIX_LENGTH) + compact.slice(0, IBAN_PREFIX_LENGTH),
      digitsOf,
    ).join(''),
  ) === 1;
