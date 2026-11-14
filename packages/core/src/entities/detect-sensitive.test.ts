import { describe, expect, it } from 'vitest';
import { CARD_NUMBER_LENGTHS, isValidCardNumber } from './card-number.ts';
import { findSensitiveIdentifiers, redactSensitiveIdentifiers } from './detect-sensitive.ts';
import { isValidIban } from './iban.ts';

// Structurally valid values of accounts and cards that do not exist.
const IBANS = [
  'FR759999900001SYNTHETIC0146',
  'DE37999999990123456789',
  'GB35SYNT00000012345678',
  'NL90SYNT0123456789',
];

describe('isValidIban', () => {
  it.each(IBANS)('accepts %s', (iban) => {
    expect(isValidIban(iban)).toBe(true);
  });

  it.each([
    ['a wrong check digit', 'FR769999900001SYNTHETIC0146'],
    ['two characters swapped', 'FR759999900001SYNTHETIC0164'],
    ['a character missing', 'FR759999900001SYNTHETIC014'],
    ['a character too many', 'DE379999999901234567890'],
    ['a country without IBAN', 'ZZ759999900001SYNTHETIC0146'],
    ['a valid check on a length that is not the one of the country', 'FR639999900001SYNTHETIC014'],
    ['a valid check on one character too many', 'NL23SYNT01234567890'],
    ['lower case', 'fr759999900001synthetic0146'],
    ['separators', 'NL90 SYNT 0123 4567 89'],
    ['nothing', ''],
  ])('refuses %s', (_case, value) => {
    expect(isValidIban(value)).toBe(false);
  });
});

describe('isValidCardNumber', () => {
  it.each([
    '4242424242424242',
    '4000000000000000006',
    '5555555555554444',
    '2223000048400011',
    '378282246310005',
    '3530111333300000',
    '6011111111111117',
  ])('accepts %s', (digits) => {
    expect(isValidCardNumber(digits)).toBe(true);
  });

  it.each([
    ['a wrong check digit', '4242424242424241'],
    ['a Luhn-valid number outside the issuer ranges', '9999999999999995'],
    ['a Luhn-valid number in a range, of a length the range does not issue', '42424242424242426'],
    ['a 14-digit Luhn-valid number, the shape of a SIRET', '36000000000008'],
    ['another 14-digit Luhn-valid number', '99999000000005'],
    ['separators', '4242 4242 4242 4242'],
    ['nothing', ''],
  ])('refuses %s', (_case, value) => {
    expect(isValidCardNumber(value)).toBe(false);
  });

  it('knows no 14-digit card', () => {
    expect(CARD_NUMBER_LENGTHS).toEqual([15, 16, 17, 18, 19]);
  });
});

describe('findSensitiveIdentifiers', () => {
  const found = (text: string) =>
    findSensitiveIdentifiers(text).map(({ type, value }) => ({ type, value }));

  it('finds an IBAN written in groups, and stops at its length', () => {
    const text = 'Pay to IBAN FR75 9999 9000 01SY NTHE TIC0 146 BIC SYNTFRPP before the 5th.';
    const [match] = findSensitiveIdentifiers(text);
    expect(match).toMatchObject({ type: 'iban', value: 'FR75 9999 9000 01SY NTHE TIC0 146' });
    expect(text.slice(match?.start, match?.end)).toBe(match?.value);
    expect(findSensitiveIdentifiers(text)).toHaveLength(1);
  });

  it.each(IBANS)('finds %s written without separators', (iban) => {
    expect(found(`(${iban})`)).toEqual([{ type: 'iban', value: iban }]);
  });

  it('finds an IBAN written with dashes or no-break spaces', () => {
    expect(found('NL90-SYNT-0123-4567-89')).toEqual([
      { type: 'iban', value: 'NL90-SYNT-0123-4567-89' },
    ]);
    expect(found('NL90 SYNT 0123 4567 89')).toHaveLength(1);
  });

  it.each([
    ['a wrong check digit', 'FR76 9999 9000 01SY NTHE TIC0 146'],
    ['a longer token that starts like one', 'NL90SYNT01234567890'],
    ['a token that ends with one', 'XNL90SYNT0123456789'],
    ['a country without IBAN', 'ZZ90SYNT0123456789'],
    ['a truncated one', 'NL90 SYNT 0123 4567'],
    ['a reference that looks like the start of one', 'Invoice FR76 of 2026'],
  ])('ignores %s', (_case, text) => {
    expect(found(text)).toEqual([]);
  });

  it('finds card numbers, grouped or not', () => {
    expect(found('Card 4242 4242 4242 4242, then 5555555555554444.')).toEqual([
      { type: 'card_number', value: '4242 4242 4242 4242' },
      { type: 'card_number', value: '5555555555554444' },
    ]);
    expect(found('Amex 3782 822463 10005')).toEqual([
      { type: 'card_number', value: '3782 822463 10005' },
    ]);
  });

  it('does not take the digits that follow a card number for a part of it', () => {
    expect(found('4242 4242 4242 4242 12 27')).toEqual([
      { type: 'card_number', value: '4242 4242 4242 4242' },
    ]);
    expect(found('ref 12 4242 4242 4242 4242')).toEqual([
      { type: 'card_number', value: '4242 4242 4242 4242' },
    ]);
  });

  it('takes the longest card number when a shorter one starts it', () => {
    expect(found('4000 0000 0000 0002 002')).toEqual([
      { type: 'card_number', value: '4000 0000 0000 0002 002' },
    ]);
  });

  it.each([
    ['a wrong check digit', '4242 4242 4242 4241'],
    ['a company identifier of 14 digits', 'SIRET 360 000 000 00008'],
    ['a Luhn-valid number outside the issuer ranges', '9999 9999 9999 9995'],
    ['a longer run of digits', '42424242424242424242424'],
    ['a short number', '4242 4242'],
  ])('ignores %s', (_case, text) => {
    expect(found(text)).toEqual([]);
  });

  it('never reads the digits of an IBAN as a card number', () => {
    // Four groups of this IBAN are a Luhn-valid 16-digit number in a card range.
    const iban = 'DE11 4242 4242 4242 4242 99';
    expect(isValidIban(iban.replaceAll(' ', ''))).toBe(true);
    expect(found(iban)).toEqual([{ type: 'iban', value: iban }]);
  });

  it('answers in the order of the text', () => {
    const text = '4242 4242 4242 4242 / NL90SYNT0123456789 / 5555 5555 5555 4444';
    expect(findSensitiveIdentifiers(text).map(({ type }) => type)).toEqual([
      'card_number',
      'iban',
      'card_number',
    ]);
  });
});

describe('findSensitiveIdentifiers on what documents really print', () => {
  const single = (text: string) => {
    const matches = findSensitiveIdentifiers(text);
    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(text.slice(match?.start, match?.end)).toBe(match?.value);
    return match;
  };

  it.each([
    ['in lower case', 'fr75 9999 9000 01sy nthe tic0 146'],
    ['in mixed case', 'Fr75 9999 9000 01Sy NtHe Tic0 146'],
    ['with narrow no-break spaces', 'FR75 9999 9000 01SY NTHE TIC0 146'],
    ['with no-break spaces', 'FR75 9999 9000 01SY NTHE TIC0 146'],
    ['with tabs', 'FR75\t9999\t9000\t01SY\tNTHE\tTIC0\t146'],
    ['with dots', 'FR75.9999.9000.01SY.NTHE.TIC0.146'],
    ['with double spaces', 'FR75  9999  9000  01SY  NTHE  TIC0  146'],
    ['across a line break', 'FR75 9999 9000 01SY\nNTHE TIC0 146'],
    ['across a Windows line break', 'FR75 9999 9000 01SY\r\nNTHE TIC0 146'],
  ])('finds an IBAN written %s', (_case, written) => {
    const text = `Account: ${written}, thank you.`;
    expect(single(text)).toMatchObject({ type: 'iban', value: written });
  });

  it('finds an IBAN that ends a sentence', () => {
    expect(single('IBAN:FR759999900001SYNTHETIC0146.')).toMatchObject({
      type: 'iban',
      value: 'FR759999900001SYNTHETIC0146',
    });
  });

  it.each([
    ['with dots', '4242.4242.4242.4242'],
    ['with dashes', '4242-4242-4242-4242'],
    ['with narrow no-break spaces', '4242 4242 4242 4242'],
    ['with no-break spaces', '4242 4242 4242 4242'],
    ['with double spaces', '4242  4242  4242  4242'],
    ['with tabs', '4242\t4242\t4242\t4242'],
  ])('finds a card number written %s', (_case, written) => {
    const text = `Card ${written} (expires 12/27)`;
    expect(single(text)).toMatchObject({ type: 'card_number', value: written });
  });

  it.each([
    ['numbers that only add up to a card number', '42 424 2424 24 242 42 42'],
    ['a card number cut in groups no network prints', '42424 24242 424242'],
    ['groups joined by different separators', '4242 4242-4242.4242'],
    ['groups on separate lines', '4242\n4242\n4242\n4242'],
    ['a row of amounts', '4 500 00 5 200 00 6 100 00 1 234 56 4 111 11'],
    ['a company identifier followed by a year', 'SIRET 360 000 000 00008 2024'],
    ['a phone number', '+33 6 12 34 56 78'],
    ['a card number glued to a word', 'REF4242424242424242'],
    ['a longer grouped number that starts with a card number', '4242 4242 4242 42425'],
  ])('ignores %s', (_case, text) => {
    expect(findSensitiveIdentifiers(text)).toEqual([]);
  });

  it('finds a card number that follows another group of four digits', () => {
    expect(single('Ticket 2026 4242 4242 4242 4242')).toMatchObject({
      type: 'card_number',
      value: '4242 4242 4242 4242',
    });
    expect(single('2026 2027 4242 4242 4242 4242 2028')).toMatchObject({
      value: '4242 4242 4242 4242',
    });
  });

  it('finds every card number of 2000 lines that start with a number of four digits', () => {
    const lines = Array.from(
      { length: 2000 },
      (_, index) => `${String(1000 + index)} 4242 4242 4242 4242`,
    );
    expect(lines.filter((line) => findSensitiveIdentifiers(line).length !== 1)).toEqual([]);
  });

  // The generator of the review: 2000 rows of 8 numbers of 1 to 5 digits.
  it('takes no row of unrelated numbers for a card number', () => {
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const number = (): string =>
      String(Math.floor(random() * 10 ** (1 + Math.floor(random() * 5))));
    const rows = Array.from({ length: 2000 }, () => Array.from({ length: 8 }, number).join(' '));
    expect(rows.filter((row) => findSensitiveIdentifiers(row).length > 0)).toEqual([]);
  });
});

describe('redactSensitiveIdentifiers', () => {
  it('replaces each identifier by its mask and leaves the rest of the text', () => {
    expect(
      redactSensitiveIdentifiers(
        'Pay FR75 9999 9000 01SY NTHE TIC0 146 or card 4242 4242 4242 4242, ref 2024-17.',
      ),
    ).toBe('Pay ****0146 or card ****4242, ref 2024-17.');
  });

  it('leaves a text without any identifier as it is', () => {
    expect(redactSensitiveIdentifiers('Synthetic Energy SA, Lyon')).toBe(
      'Synthetic Energy SA, Lyon',
    );
  });
});
