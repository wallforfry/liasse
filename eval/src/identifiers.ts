import { createPrng } from './prng.ts';

export const CORPUS_SEED = 'liasse-eval-v1';

// No bank holds this code: every IBAN of the corpus is built on it, which is what lets a
// test refuse any other.
export const FICTITIOUS_BANK_CODE = '99999';
// Major industry identifier 9 is left to national standards bodies: no card network
// issues numbers under it.
export const FICTITIOUS_CARD_PREFIX = '9999';

// Digits drawn from the seed and a label, so that each identifier is the same at every
// generation and independent of the others.
export const seededDigits = (label: string, count: number): string => {
  const random = createPrng(`${CORPUS_SEED}/${label}`);
  return Array.from({ length: count }, () => String(Math.floor(random() * 10))).join('');
};

const luhnSum = (digits: string): number =>
  Array.from(digits)
    .reverse()
    .map(Number)
    .reduce((sum, digit, index) => {
      const doubled = index % 2 === 1 ? digit * 2 : digit;
      return sum + (doubled > 9 ? doubled - 9 : doubled);
    }, 0);

export const isLuhnValid = (digits: string): boolean =>
  /^\d+$/.test(digits) && luhnSum(digits) % 10 === 0;

const withLuhnCheck = (payload: string): string =>
  `${payload}${String((10 - (luhnSum(`${payload}0`) % 10)) % 10)}`;

// A French company number: nine digits that pass the Luhn check. It is drawn from the
// seed, not looked up, so it identifies no company on purpose.
export const siren = (label: string): string => withLuhnCheck(seededDigits(`siren/${label}`, 8));

// The number of an establishment: the company number, four digits and a Luhn check.
export const siret = (label: string): string => withLuhnCheck(`${siren(label)}0001`);

export const cardNumber = (label: string): string =>
  withLuhnCheck(`${FICTITIOUS_CARD_PREFIX}${seededDigits(`card/${label}`, 11)}`);

// Remainder of a decimal number of any length, taken a few digits at a time.
const mod97 = (digits: string): number =>
  Array.from(digits).reduce((remainder, digit) => (remainder * 10 + Number(digit)) % 97, 0);

const lettersToDigits = (text: string): string =>
  Array.from(text.toUpperCase())
    .map((character) =>
      /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character,
    )
    .join('');

const compact = (text: string): string => text.replace(/\s/g, '');

export const isValidIban = (iban: string): boolean => {
  const value = compact(iban).toUpperCase();
  return (
    /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(value) &&
    mod97(lettersToDigits(`${value.slice(4)}${value.slice(0, 4)}`)) === 1
  );
};

// The bank code of a French IBAN, or undefined for an IBAN of another country.
export const frenchBankCode = (iban: string): string | undefined => {
  const value = compact(iban).toUpperCase();
  return value.startsWith('FR') ? value.slice(4, 9) : undefined;
};

// A French IBAN on the fictitious bank code, with a valid national key and valid check
// digits, printed in groups of four.
export const frenchIban = (label: string): string => {
  const branch = seededDigits(`iban/branch/${label}`, 5);
  const account = seededDigits(`iban/account/${label}`, 11);
  const key =
    97 - ((89 * Number(FICTITIOUS_BANK_CODE) + 15 * Number(branch) + 3 * mod97(account)) % 97);
  const bban = `${FICTITIOUS_BANK_CODE}${branch}${account}${String(key).padStart(2, '0')}`;
  const check = 98 - mod97(lettersToDigits(`${bban}FR00`));
  return (`FR${String(check).padStart(2, '0')}${bban}`.match(/.{1,4}/g) ?? []).join(' ');
};

// A French social security number with its key. The department is 99 (born abroad) and
// the country code 999, which names no country: the number is well formed and nobody's.
export const socialSecurityNumber = (label: string): string => {
  const body = `2850599999${seededDigits(`nir/${label}`, 3)}`;
  const key = 97 - mod97(body);
  return `${body.slice(0, 1)} ${body.slice(1, 3)} ${body.slice(3, 5)} ${body.slice(5, 7)} ${body.slice(7, 10)} ${body.slice(10)} ${String(key).padStart(2, '0')}`;
};

// A French tax number has thirteen digits and starts with 0 to 3; this one starts with 99.
export const taxNumber = (label: string): string => {
  const digits = `99${seededDigits(`tax/${label}`, 11)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)} ${digits.slice(10)}`;
};
