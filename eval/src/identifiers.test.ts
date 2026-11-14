import { describe, expect, it } from 'vitest';
import {
  FICTITIOUS_BANK_CODE,
  frenchBankCode,
  frenchIban,
  frenchNationalKey,
  isLuhnValid,
  isValidIban,
  seededDigits,
  siren,
  siret,
  socialSecurityKey,
  socialSecurityNumber,
  taxNumber,
  TEST_CARD_NUMBER,
} from './identifiers.ts';

const digitsOf = (text: string): string => text.replace(/\D/g, '');

describe('the checks', () => {
  // The example IBANs of the registry of IBAN formats, which belong to no account.
  it.each([
    'GB82 WEST 1234 5698 7654 32',
    'DE89 3704 0044 0532 0130 00',
    'FR14 2004 1010 0505 0001 3M02 606',
  ])('accept the specimen IBAN %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it('refuse an IBAN with one digit changed or a broken shape', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(isValidIban('82GB WEST 1234 5698 7654 32')).toBe(false);
  });

  it('accept a number that passes the Luhn check and refuse its neighbour', () => {
    expect(isLuhnValid('79927398713')).toBe(true);
    expect(isLuhnValid('79927398714')).toBe(false);
    expect(isLuhnValid('7992739871a')).toBe(false);
  });
});

describe('the generated identifiers', () => {
  it('are the same at every call and differ from one label to the next', () => {
    expect(seededDigits('a', 12)).toBe(seededDigits('a', 12));
    expect(seededDigits('a', 12)).not.toBe(seededDigits('b', 12));
    expect(seededDigits('a', 12)).toMatch(/^\d{12}$/);
  });

  it.each(['jane', 'malo', 'other'])(
    'build a valid French IBAN on the fictitious bank for %s',
    (label) => {
      const iban = frenchIban(label);
      expect(iban).toMatch(/^FR\d{2}( [0-9]{4}){5} [0-9]{3}$/);
      expect(isValidIban(iban)).toBe(true);
      expect(frenchBankCode(iban)).toBe(FICTITIOUS_BANK_CODE);
    },
  );

  it('build an IBAN whose national key is not the one a French bank requires', () => {
    const bban = digitsOf(frenchIban('jane')).slice(2);
    const [bank, branch, account, key] = [
      bban.slice(0, 5),
      bban.slice(5, 10),
      bban.slice(10, 21),
      bban.slice(21),
    ];
    const required =
      97n - ((89n * BigInt(bank) + 15n * BigInt(branch) + 3n * BigInt(account)) % 97n);
    expect(BigInt(frenchNationalKey(bank, branch, account))).toBe(required);
    expect(BigInt(key)).not.toBe(required);
  });

  it.each(Array.from({ length: 40 }, (_, index) => `company-${String(index)}`))(
    'build company numbers that fail the Luhn check for %s',
    (label) => {
      expect(siren(label)).toMatch(/^\d{9}$/);
      expect(isLuhnValid(siren(label))).toBe(false);
      expect(siret(label)).toMatch(/^\d{14}$/);
      expect(siret(label).startsWith(siren(label))).toBe(true);
      expect(isLuhnValid(siret(label))).toBe(false);
    },
  );

  it('use a card number that a detector of card numbers recognises', () => {
    expect(TEST_CARD_NUMBER).toMatch(/^4\d{15}$/);
    expect(isLuhnValid(TEST_CARD_NUMBER)).toBe(true);
  });

  it.each(['jane', 'a', 'b', 'c'])(
    'build a social security number whose key is not the valid one for %s',
    (label) => {
      const digits = digitsOf(socialSecurityNumber(label));
      expect(digits).toHaveLength(15);
      expect(Number(digits.slice(13))).not.toBe(socialSecurityKey(digits.slice(0, 13)));
      expect(97n - (BigInt(digits.slice(0, 13)) % 97n)).toBe(
        BigInt(socialSecurityKey(digits.slice(0, 13))),
      );
    },
  );

  it('build a tax number outside the range the administration assigns', () => {
    expect(digitsOf(taxNumber('a'))).toMatch(/^99\d{11}$/);
  });
});
