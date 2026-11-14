import { describe, expect, it } from 'vitest';
import {
  SYNTHETIC_CARD,
  SYNTHETIC_IBAN,
  TEST_IDENTIFIER_KEY,
} from '../entities/support.test-helper.ts';
import { addressKey, isCompleteAddress } from './address.ts';
import {
  haveConflictingSubjectIdentifiers,
  isAttachingSubjectIdentifier,
} from './subject-identifier-rules.ts';
import {
  isWrittenAs,
  parseSubjectIdentifiers,
  storeSubjectIdentifier,
  toSubjectIdentifiersColumn,
  viewSubjectIdentifier,
} from './subject-identifiers.ts';
import { isDistinctiveLabel, subjectLabelKey } from './subject-label.ts';

const store = (kind: Parameters<typeof storeSubjectIdentifier>[1], written: string) =>
  storeSubjectIdentifier(TEST_IDENTIFIER_KEY, kind, written);

describe('addressKey', () => {
  it.each([
    ['12 rue des Lilas, 69003 Lyon', '12 rue lilas 69003 lyon'],
    ['12, Rue des LILAS - 69003 LYON', '12 rue lilas 69003 lyon'],
    ['12 av. de la République 75011 Paris', '12 avenue republique 75011 paris'],
    ['3 Bd Voltaire, 75011 Paris', '3 boulevard voltaire 75011 paris'],
    ['Hauptstr. 5, 10115 Berlin', 'hauptstrasse 5 10115 berlin'],
    ['Hauptstraße 5, 10115 Berlin', 'hauptstrasse 5 10115 berlin'],
    ['１２ rue des Lilas', '12 rue lilas'],
    ['東京都千代田区丸の内1-1', '東京都千代田区丸の内1 1'],
    ['---', ''],
  ])('reads %j as %j', (written, key) => {
    expect(addressKey(written)).toBe(key);
  });

  it('keeps the order of the words: two numbers swapped are two places', () => {
    expect(addressKey('3 rue du 12 Septembre')).not.toBe(addressKey('12 rue du 3 Septembre'));
  });

  it.each([
    ['12 rue des Lilas, 69003 Lyon', true],
    ['12 bis rue des Lilas, 69003 Lyon', true],
    ['12B rue des Lilas, 69003 Lyon', true],
    ['3 ter avenue Foch, 75116 Paris', true],
    ['7 quater bd Voltaire, 75011 Paris', true],
    ['221 Baker Street, 10115 London', true],
    ['Hauptstraße 5, 10115 Berlin', true],
    ['Hauptstr. 5a, 10115 Berlin', true],
    ['12 rue des Lilas, Lyon', false],
    ['rue des Lilas, 69003 Lyon', false],
    ['12 69003', false],
    ['', false],
    // A number in the name of the street is not the number of a house.
    ['Rue du 11 Novembre 1918, 69003 Lyon', false],
    ['Avenue du 8 Mai 1945, Lyon', false],
    // A building, an apartment or a post-office box is not a house number.
    ['Résidence Les Pins, Bât 2, 69003 Lyon', false],
    ['Bât 2, rue des Lilas, 69003 Lyon', false],
    ['Appartement 12, 69003 Lyon', false],
    ['BP 123, 69003 Lyon', false],
    ['CS 30012, 69003 Lyon Cedex', false],
    // The postal code comes after the street.
    ['69003 rue des Lilas', false],
    // A house number has at most four digits, and a street follows it.
    ['12345 avenue Foch, 75116 Paris', false],
    ['12 Les Pins, 69003 Lyon', false],
  ] as const)('holds %j as complete: %s', (written, complete) => {
    expect(isCompleteAddress(addressKey(written))).toBe(complete);
  });
});

describe('subjectLabelKey', () => {
  it('ignores case, accents on Latin letters, punctuation and width', () => {
    expect(subjectLabelKey('  Appartement de LYON ')).toBe('appartement de lyon');
    expect(subjectLabelKey('Véhicule: Clio')).toBe('vehicule clio');
    expect(subjectLabelKey('Ｃａｒ')).toBe('car');
  });

  it('keeps what tells two labels apart in other scripts, and the words of a legal form', () => {
    expect(subjectLabelKey('ハハ')).not.toBe(subjectLabelKey('パパ'));
    expect(subjectLabelKey('Contrat SA maison')).toBe('contrat sa maison');
    expect(subjectLabelKey('!!!')).toBe('!!!');
    expect(subjectLabelKey('!!!')).not.toBe(subjectLabelKey('???'));
  });

  it('holds a label of one or two letters as a fragment, except in a dense script', () => {
    expect(isDistinctiveLabel('Car')).toBe(true);
    expect(isDistinctiveLabel('n1')).toBe(false);
    expect(isDistinctiveLabel('--')).toBe(false);
    expect(isDistinctiveLabel('車')).toBe(true);
    expect(isDistinctiveLabel('집')).toBe(true);
  });
});

describe('storeSubjectIdentifier', () => {
  it('reads a plate or a vehicle identification number for a vehicle', () => {
    expect(store('vehicle', 'ab-123-cd')).toEqual([{ type: 'license_plate', value: 'AB123CD' }]);
    expect(store('vehicle', 'AB 123 CD')).toEqual([{ type: 'license_plate', value: 'AB123CD' }]);
    expect(store('vehicle', 'vf1 rfb00 3 57123456')).toEqual([
      { type: 'vin', value: 'VF1RFB00357123456' },
    ]);
    expect(store('vehicle', 'А123ВС77')).toEqual([{ type: 'license_plate', value: 'А123ВС77' }]);
    expect(store('vehicle', '京A·12345')).toEqual([{ type: 'license_plate', value: '京A12345' }]);
  });

  it('ignores a fragment', () => {
    expect(store('vehicle', 'A1')).toEqual([]);
    expect(store('vehicle', 'ABCDEF')).toEqual([]);
    expect(store('vehicle', 'ABCDEFGHIJ1234567890')).toEqual([]);
    expect(store('contract', '12')).toEqual([]);
    expect(store('contract', 'POLICY')).toEqual([]);
    expect(store('contract', '--')).toEqual([]);
    expect(store('property', '...')).toEqual([]);
  });

  it('reads a number for a contract, a job and an account, and an address for a property', () => {
    expect(store('contract', 'hab-2025/00417')).toEqual([
      { type: 'contract_number', value: 'HAB202500417' },
    ]);
    expect(store('employment', 'Mat. 004512')).toEqual([
      { type: 'contract_number', value: 'MAT004512' },
    ]);
    expect(store('account', 'N° 0012345')).toEqual([
      { type: 'contract_number', value: 'N0012345' },
    ]);
    expect(store('property', '12 rue des Lilas, 69003 Lyon')).toEqual([
      { type: 'address', value: '12 rue lilas 69003 lyon' },
    ]);
    expect(store('dependent', '2020-05-17')).toEqual([]);
  });

  it('never stores an IBAN or a card number in clear, whatever the kind and the wording', () => {
    for (const kind of ['account', 'contract', 'vehicle', 'property', 'dependent'] as const) {
      for (const written of [
        SYNTHETIC_IBAN,
        SYNTHETIC_IBAN.toLowerCase(),
        `IBAN ${SYNTHETIC_IBAN.replace(/(.{4})/g, '$1 ')}`,
        SYNTHETIC_IBAN.replace(/(.{4})/g, '$1/'),
      ]) {
        const stored = store(kind, written);
        expect(stored).toMatchObject([{ type: 'iban', last4: '0146' }]);
        expect(JSON.stringify(stored)).not.toContain('SYNTHETIC');
      }
      expect(store(kind, '4242 4242 4242 4242')).toMatchObject([
        { type: 'card_number', last4: '4242' },
      ]);
    }
    expect(store('account', SYNTHETIC_IBAN)).toEqual(store('account', ` ${SYNTHETIC_IBAN} `));
    expect(viewSubjectIdentifier(store('account', SYNTHETIC_CARD)[0] ?? fail())).toEqual({
      type: 'card_number',
      value: '****4242',
    });
  });

  it('round-trips through the column', () => {
    const identifiers = [...store('vehicle', 'AB-123-CD'), ...store('account', SYNTHETIC_IBAN)];
    expect(parseSubjectIdentifiers(toSubjectIdentifiersColumn(identifiers))).toEqual(identifiers);
    expect(parseSubjectIdentifiers({})).toEqual([]);
  });
});

const fail = (): never => {
  throw new Error('expected an identifier');
};

describe('the rules on subject identifiers', () => {
  it('lets a plate, a long contract number of a known issuer and a full address attach on their own', () => {
    const attaches = (kind: Parameters<typeof store>[0], written: string, issuerId?: string) =>
      storeSubjectIdentifier(TEST_IDENTIFIER_KEY, kind, written, issuerId).some(
        isAttachingSubjectIdentifier,
      );
    expect(attaches('vehicle', 'AB-123-CD')).toBe(true);
    expect(attaches('contract', 'HAB-00417', 'ent_issuer')).toBe(true);
    expect(attaches('contract', 'HAB-00417')).toBe(false);
    expect(attaches('contract', 'H-417', 'ent_issuer')).toBe(false);
    expect(attaches('property', '12 rue des Lilas, 69003 Lyon')).toBe(true);
    expect(attaches('property', 'rue des Lilas, Lyon')).toBe(false);
    expect(attaches('account', SYNTHETIC_IBAN)).toBe(true);
  });

  it('tells two subjects apart when they carry two values of one type', () => {
    const conflict = (left: ReturnType<typeof store>, right: ReturnType<typeof store>) =>
      haveConflictingSubjectIdentifiers(left, right);
    expect(conflict(store('vehicle', 'AB-123-CD'), store('vehicle', 'EF-456-GH'))).toBe(true);
    expect(conflict(store('vehicle', 'AB-123-CD'), store('vehicle', 'ab 123 cd'))).toBe(false);
    expect(conflict(store('vehicle', 'AB-123-CD'), store('vehicle', 'VF1RFB00357123456'))).toBe(
      false,
    );
    expect(conflict(store('vehicle', 'AB-123-CD'), [])).toBe(false);
    expect(conflict(store('contract', 'H-417'), store('contract', 'H-418'))).toBe(true);
    const numberOf = (written: string, issuerId: string) =>
      storeSubjectIdentifier(TEST_IDENTIFIER_KEY, 'contract', written, issuerId);
    expect(conflict(numberOf('H-417', 'ent_a'), numberOf('H-418', 'ent_a'))).toBe(true);
    expect(conflict(numberOf('H-417', 'ent_a'), numberOf('H-418', 'ent_b'))).toBe(true);
    expect(conflict(numberOf('H-417', 'ent_a'), store('contract', 'H-418'))).toBe(true);
    // The holder quotes the number the insurer gave: one number, one contract.
    expect(conflict(numberOf('H-417', 'ent_a'), numberOf('H-417', 'ent_b'))).toBe(false);
    expect(
      conflict(
        store('property', '12 rue des Lilas, 69003 Lyon'),
        store('property', '14 rue des Lilas, 69003 Lyon'),
      ),
    ).toBe(true);
    expect(
      conflict(
        store('property', '12 rue des Lilas, 69003 Lyon'),
        store('property', 'rue des Lilas, Lyon'),
      ),
    ).toBe(false);
    expect(conflict(store('account', SYNTHETIC_IBAN), store('account', SYNTHETIC_CARD))).toBe(
      false,
    );
  });

  it('matches an identifier with the way a person writes it, never a hashed one', () => {
    const [plate] = store('vehicle', 'AB-123-CD');
    const [address] = store('property', '12 rue des Lilas, 69003 Lyon');
    const [iban] = store('account', SYNTHETIC_IBAN);
    expect(isWrittenAs(plate ?? fail(), 'ab 123 cd')).toBe(true);
    expect(isWrittenAs(plate ?? fail(), 'ab 123 ce')).toBe(false);
    expect(isWrittenAs(address ?? fail(), '12, RUE DES LILAS 69003 LYON')).toBe(true);
    expect(isWrittenAs(iban ?? fail(), SYNTHETIC_IBAN)).toBe(false);
  });
});
