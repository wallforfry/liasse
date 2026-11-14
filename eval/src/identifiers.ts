import { createPrng } from './prng.ts';

export const CORPUS_SEED = 'liasse-eval-v1';

// Every identifier of the corpus is built so that it cannot designate anything real, by
// one of three means: a check that real ones always pass and this one fails (company
// numbers, the national key of the bank account, the key of the social security number),
// a range that is never assigned (the tax number, the bank code), or a value published
// for tests (the card number). Drawing well-formed numbers at random is not enough: one
// valid French company number in three is assigned.

export const FICTITIOUS_BANK_CODE = '99999';

// The test number the card networks publish for a card that is never issued. It is in a
// real issuer range and passes the Luhn check, which is what a detector of card numbers
// looks for: the corpus needs it found and masked.
export const TEST_CARD_NUMBER = '4111111111111111';

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

// How far the last digit is moved from the one the Luhn check wants: any shift from 1 to
// 9 makes the number fail the check.
const WRONG_CHECK_SHIFT = 5;

const withWrongLuhnCheck = (payload: string): string => {
  const valid = (10 - (luhnSum(`${payload}0`) % 10)) % 10;
  return `${payload}${String((valid + WRONG_CHECK_SHIFT) % 10)}`;
};

// Nine digits shaped like a French company number that fail the Luhn check. The register
// only holds numbers that pass it, so this one is in no register, whatever its digits.
export const siren = (label: string): string =>
  withWrongLuhnCheck(seededDigits(`siren/${label}`, 8));

// The number of an establishment: the company number, four digits and a check digit,
// wrong as well.
export const siret = (label: string): string => withWrongLuhnCheck(`${siren(label)}0001`);

// Remainder of a decimal number of any length, taken a digit at a time.
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

// The national key a French account number must end with, from 1 to 97.
export const frenchNationalKey = (bank: string, branch: string, account: string): number =>
  97 - ((89 * mod97(bank) + 15 * mod97(branch) + 3 * mod97(account)) % 97);

// A French IBAN that passes the international check, so that a detector finds it, and
// names no account: its bank code is not a bank, and its national key is one more than
// the key French banks require, so no French bank could hold it.
export const frenchIban = (label: string): string => {
  const branch = seededDigits(`iban/branch/${label}`, 5);
  const account = seededDigits(`iban/account/${label}`, 11);
  const wrongKey = (frenchNationalKey(FICTITIOUS_BANK_CODE, branch, account) % 97) + 1;
  const bban = `${FICTITIOUS_BANK_CODE}${branch}${account}${String(wrongKey).padStart(2, '0')}`;
  const check = 98 - mod97(lettersToDigits(`${bban}FR00`));
  return (`FR${String(check).padStart(2, '0')}${bban}`.match(/.{1,4}/g) ?? []).join(' ');
};

// The key a French social security number must end with.
export const socialSecurityKey = (thirteenDigits: string): number => 97 - mod97(thirteenDigits);

// Shaped like the social security number of a woman born in May 1972 abroad, with a key
// that is one more than the valid one: no register can hold it.
export const socialSecurityNumber = (label: string): string => {
  const body = `2720599999${seededDigits(`nir/${label}`, 3)}`;
  const wrongKey = (socialSecurityKey(body) % 97) + 1;
  return `${body.slice(0, 1)} ${body.slice(1, 3)} ${body.slice(3, 5)} ${body.slice(5, 7)} ${body.slice(7, 10)} ${body.slice(10)} ${String(wrongKey).padStart(2, '0')}`;
};

// A French tax number has thirteen digits and starts with 0 to 3; this one starts with 99.
export const taxNumber = (label: string): string => {
  const digits = `99${seededDigits(`tax/${label}`, 11)}`;
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 10)} ${digits.slice(10)}`;
};
