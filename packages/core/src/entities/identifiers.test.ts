import { describe, expect, it } from 'vitest';
import {
  haveConflictingIdentifiers,
  identifierIdentity,
  isAttachingCustomerNumber,
  isGlobalIdentifier,
  type MentionIdentifier,
  mentionIdentifierSchema,
  mergeIdentifiers,
  parseIdentifiersColumn,
  rejectionOf,
  sharedGlobalIdentifiers,
  storeIdentifier,
  toIdentifiersColumn,
  viewIdentifier,
} from './identifiers.ts';
import { maskSensitiveIdentifier } from './sensitive.ts';
import { SYNTHETIC_CARD, SYNTHETIC_IBAN, TEST_IDENTIFIER_KEY } from './support.test-helper.ts';

const store = (identifier: MentionIdentifier) => storeIdentifier(TEST_IDENTIFIER_KEY, identifier);

describe('mentionIdentifierSchema', () => {
  it('needs a format for an identifier of a free format, and takes none otherwise', () => {
    expect(mentionIdentifierSchema.safeParse({ type: 'other', value: 'X1' }).success).toBe(false);
    expect(
      mentionIdentifierSchema.safeParse({ type: 'other', format: 'PDL', value: 'X1' }).success,
    ).toBe(true);
    expect(
      mentionIdentifierSchema.safeParse({ type: 'company_id', format: 'SIREN', value: 'X1' })
        .success,
    ).toBe(false);
  });

  it('refuses an unknown type and an empty value', () => {
    expect(mentionIdentifierSchema.safeParse({ type: 'passport', value: 'X1' }).success).toBe(
      false,
    );
    expect(mentionIdentifierSchema.safeParse({ type: 'company_id', value: '' }).success).toBe(
      false,
    );
  });
});

describe('storeIdentifier', () => {
  it.each([
    ['company_id', ' 999 990 001 ', '999990001'],
    ['company_id', '999.990.001-00017', '99999000100017'],
    ['vat_number', 'fr 00 999 990 001', 'FR00999990001'],
    ['customer_number', 'clt-00412/b', 'CLT00412B'],
  ] as const)('normalizes a %s written %s', (type, written, value) => {
    expect(store({ type, value: written })).toEqual([{ type, value }]);
  });

  it('normalizes an identifier of a free format and its format', () => {
    expect(store({ type: 'other', format: 'pdl', value: '0999 9999 9999 99' })).toEqual([
      { type: 'other', format: 'PDL', value: '09999999999999' },
    ]);
  });

  it('masks an IBAN and a card number', () => {
    const { last4, hash } = maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'iban', SYNTHETIC_IBAN);
    expect(store({ type: 'iban', value: 'fr75 9999 9000 01sy nthe tic0 146' })).toEqual([
      { type: 'iban', last4, hash },
    ]);
    expect(store({ type: 'card_number', value: '4242 4242 4242 4242' })).toEqual([
      {
        type: 'card_number',
        last4: '4242',
        hash: maskSensitiveIdentifier(TEST_IDENTIFIER_KEY, 'card_number', SYNTHETIC_CARD).hash,
      },
    ]);
  });

  it.each(['customer_number', 'company_id', 'vat_number'] as const)(
    'masks an IBAN or a card number labelled %s',
    (type) => {
      expect(store({ type, value: SYNTHETIC_IBAN })).toEqual(
        store({ type: 'iban', value: SYNTHETIC_IBAN }),
      );
      expect(store({ type, value: '4242 4242 4242 4242' })).toEqual(
        store({ type: 'card_number', value: SYNTHETIC_CARD }),
      );
    },
  );

  it('masks an IBAN given in a free format', () => {
    expect(store({ type: 'other', format: 'account', value: SYNTHETIC_IBAN })).toEqual(
      store({ type: 'iban', value: SYNTHETIC_IBAN }),
    );
  });

  it('stores nothing for a value without a letter or a digit', () => {
    expect(store({ type: 'company_id', value: ' - . ' })).toEqual([]);
    expect(store({ type: 'card_number', value: 'unknown' })).toEqual([]);
  });

  it.each([
    ['company_id', '5'],
    ['company_id', '1234'],
    ['company_id', 'ABCDEF'],
    ['vat_number', 'FR'],
    ['vat_number', 'FRAB'],
    ['vat_number', '123'],
  ] as const)('stores nothing for a %s that is only "%s"', (type, value) => {
    expect(store({ type, value })).toEqual([]);
    expect(rejectionOf({ type, value })).toBe('malformed');
  });

  it.each([
    ['company_id', '12345'],
    ['company_id', 'HRB12345'],
    ['vat_number', 'RO12'],
    ['customer_number', '7'],
  ] as const)('keeps a %s written "%s"', (type, value) => {
    expect(store({ type, value })).toEqual([{ type, value }]);
    expect(rejectionOf({ type, value })).toBeUndefined();
  });

  it('tells an empty value from a malformed one', () => {
    expect(rejectionOf({ type: 'customer_number', value: ' - ' })).toBe('empty');
  });
});

describe('haveConflictingIdentifiers', () => {
  const companyId = (value: string) => ({ type: 'company_id', value }) as const;
  const vatNumber = (value: string) => ({ type: 'vat_number', value }) as const;

  it('tells two different values of one unique type', () => {
    expect(haveConflictingIdentifiers([companyId('111111111')], [companyId('222222222')])).toBe(
      true,
    );
    expect(haveConflictingIdentifiers([vatNumber('FR111')], [vatNumber('FR222')])).toBe(true);
  });

  it('finds no conflict in equal values, other types, or a type one side lacks', () => {
    expect(haveConflictingIdentifiers([companyId('111111111')], [companyId('111111111')])).toBe(
      false,
    );
    expect(haveConflictingIdentifiers([companyId('111111111')], [vatNumber('FR222')])).toBe(false);
    expect(haveConflictingIdentifiers([companyId('111111111')], [])).toBe(false);
  });

  it('holds a company id of nine characters or more as the start of a longer one', () => {
    expect(
      haveConflictingIdentifiers([companyId('999990001')], [companyId('99999000100017')]),
    ).toBe(false);
    expect(
      haveConflictingIdentifiers([companyId('99999000100017')], [companyId('999990001')]),
    ).toBe(false);
    expect(haveConflictingIdentifiers([companyId('99999000')], [companyId('999990001')])).toBe(
      true,
    );
  });

  it('never holds a VAT number as the start of another', () => {
    expect(
      haveConflictingIdentifiers([vatNumber('FR2222222222')], [vatNumber('FR22222222222')]),
    ).toBe(true);
  });
});

describe('stored identifiers', () => {
  const companyId = { type: 'company_id', value: '999990001' } as const;
  const iban = { type: 'iban', last4: '0146', hash: 'a'.repeat(64) } as const;
  const meter = { type: 'other', format: 'PDL', value: '09999999999999' } as const;

  it('tells identifiers apart by type, by value or hash, and by format', () => {
    const identities = [
      companyId,
      { type: 'customer_number', value: '999990001' } as const,
      iban,
      { ...iban, hash: 'b'.repeat(64) },
      { ...iban, type: 'card_number' } as const,
      meter,
      { ...meter, format: 'PCE' },
    ].map(identifierIdentity);
    expect(new Set(identities).size).toBe(identities.length);
    expect(identifierIdentity({ ...iban, last4: '9999' })).toBe(identifierIdentity(iban));
  });

  const customerNumber = { type: 'customer_number', value: 'CLT00412' } as const;

  it('holds as global every type except the customer number and the free format', () => {
    expect(
      [
        companyId,
        { type: 'vat_number', value: 'FR00999990001' } as const,
        iban,
        { ...iban, type: 'card_number' } as const,
        customerNumber,
        meter,
      ].map(isGlobalIdentifier),
    ).toEqual([true, true, true, true, false, false]);
  });

  it('lets a customer number attach from six characters on', () => {
    expect(
      [
        { ...customerNumber, value: '123456' },
        { ...customerNumber, value: '12345' },
        { ...companyId, value: '123456' },
        { ...meter, value: '123456' },
        iban,
      ].map(isAttachingCustomerNumber),
    ).toEqual([true, false, false, false, false]);
  });

  it('merges without duplicates, the known ones first', () => {
    expect(mergeIdentifiers([companyId, iban], [iban, meter, companyId])).toEqual([
      companyId,
      iban,
      meter,
    ]);
  });

  it('finds the global identifiers two lists share', () => {
    expect(sharedGlobalIdentifiers([companyId, iban, meter], [meter, iban])).toEqual([iban]);
    expect(sharedGlobalIdentifiers([meter], [meter])).toEqual([]);
    expect(sharedGlobalIdentifiers([customerNumber], [customerNumber])).toEqual([]);
  });

  it('shows a sensitive identifier masked, without its hash', () => {
    expect(viewIdentifier(iban)).toEqual({ type: 'iban', value: '****0146' });
    expect(viewIdentifier(companyId)).toEqual(companyId);
    expect(viewIdentifier(meter)).toEqual(meter);
  });

  it('reads the column back, empty by default', () => {
    expect(parseIdentifiersColumn({})).toEqual([]);
    expect(parseIdentifiersColumn(toIdentifiersColumn([companyId, iban, meter]))).toEqual([
      companyId,
      iban,
      meter,
    ]);
  });

  it('refuses a column that holds an IBAN in clear', () => {
    expect(() =>
      parseIdentifiersColumn({ items: [{ type: 'iban', value: SYNTHETIC_IBAN }] }),
    ).toThrow();
  });
});
