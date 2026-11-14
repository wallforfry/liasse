import { describe, expect, it } from 'vitest';
import { factSupport, quoteSupports, type SupportKind } from './support.ts';

const EUR = (value: number) => ({ value, currency: 'EUR' });
const USD = (value: number) => ({ value, currency: 'USD' });

const supports = (kind: SupportKind, value: unknown, quote: string, language?: string) =>
  quoteSupports(kind, value, quote, language);

// Verdict P4: values its quote does not state, behind quotes that exist in the text.
describe('a value its quote does not state is not supported', () => {
  it('an issuer quoted by a word of the page', () => {
    expect(supports('text', 'Totally Invented Corp', 'Invoice')).toBe(false);
  });

  it('a reference quoted by three letters', () => {
    expect(supports('text', 'HALLUCINATED-999', 'due')).toBe(false);
  });

  it('an amount whose digits are those of the quote without its decimal mark', () => {
    expect(supports('money', USD(8420), 'Total 84,20 EUR')).toBe(false);
    expect(supports('money', EUR(8420), 'Total 84,20 EUR')).toBe(false);
  });

  it('an amount in a currency the quote contradicts', () => {
    expect(supports('money', USD(84.2), 'Total 84,20 EUR')).toBe(false);
    expect(supports('money', USD(84.2), 'Total 84,20 €')).toBe(false);
    expect(supports('money', EUR(84.2), 'Total £84.20')).toBe(false);
  });

  it('a date whose year is only part of a reference', () => {
    expect(supports('date', '2026-01-01', 'SYN-2026-001')).toBe(false);
  });

  it('a date that takes the day of the quote for its year', () => {
    expect(supports('date', '2018-12-25', 'due 18/10/2026', 'fr')).toBe(false);
  });

  it('an identifier quoted by its label only', () => {
    expect(supports('identifier', 'PDL-999999', 'Meter')).toBe(false);
  });

  it('a number the quote does not hold', () => {
    expect(supports('number', -20, 'Total 84,20 EUR')).toBe(false);
    expect(supports('number', 8420, 'Total 84,20 EUR')).toBe(false);
  });
});

describe('a value its quote states is supported, however the document writes it', () => {
  it.each([
    [EUR(84.2), 'Total 84,20 €'],
    [EUR(84.2), 'Total TTC 84.20 EUR'],
    [EUR(1234.5), 'Total 1 234,50 €'],
    [EUR(1234.5), 'Total 1 234,50 €'],
    [EUR(1234567.89), 'Montant 1.234.567,89 EUR'],
    [USD(1234.5), 'Amount due $1,234.50'],
    [USD(8420), 'Amount due 8,420 USD'],
    [EUR(84.2), 'Total 84,20'],
    [EUR(-84.2), 'Avoir 84,20 €'],
    [EUR(84.2), 'Total 84,20 euros'],
  ])('money %j from %j', (value, quote) => {
    expect(supports('money', value, quote)).toBe(true);
  });

  it.each([
    [350, 'Consumption 350 kWh'],
    [0.5, 'rate 0,5 %'],
    [12, 'Duration: 12 months'],
  ])('number %j from %j', (value, quote) => {
    expect(supports('number', value, quote)).toBe(true);
  });

  it.each([
    ['2026-10-18', 'due 18/10/2026', 'fr'],
    ['2026-10-18', 'due 18.10.2026', 'de'],
    ['2026-10-18', 'le 18 octobre 2026', 'fr'],
    ['2026-10-18', 'el 18 de octubre de 2026', 'es'],
    ['2026-10-18', 'Due October 18, 2026', 'en'],
    ['2026-10-18', 'Due Oct. 18th 2026', 'en'],
    ['2026-10-18', '18/10/2026', 'en'],
    ['2026-10-18', '10/18/2026', 'en'],
    ['2026-10-18', 'issued 2026-10-18', undefined],
    ['2026-10-18', 'due 18/10/26', 'fr'],
    ['2026-08-03', 'le 3 août 2026', 'fr'],
    ['2026-03-01', 'Am 1. März 2026', 'de'],
  ])('date %s from %j (%s)', (value, quote, language) => {
    expect(supports('date', value, quote, language)).toBe(true);
  });

  it('a period stated by its two ends, or as whole months', () => {
    expect(
      supports(
        'period',
        { start: '2026-09-01', end: '2026-09-30' },
        'du 01/09/2026 au 30/09/2026',
        'fr',
      ),
    ).toBe(true);
    expect(
      supports('period', { start: '2026-09-01', end: '2026-09-30' }, 'September 2026', 'en'),
    ).toBe(true);
    expect(
      supports(
        'period',
        { start: '2026-09-01', end: '2026-10-31' },
        'September 2026 to October 2026',
        'en',
      ),
    ).toBe(true);
    expect(
      supports('period', { start: '2026-09-02', end: '2026-09-30' }, 'September 2026', 'en'),
    ).toBe(false);
    expect(
      supports('period', { start: '2026-09-01', end: '2026-09-29' }, 'September 2026', 'en'),
    ).toBe(false);
  });

  it('a key date by its date', () => {
    const keyDate = { kind: 'due', date: '2026-10-18', label: 'Payment' };
    expect(supports('key_date', keyDate, 'due 18/10/2026', 'fr')).toBe(true);
    expect(supports('key_date', { ...keyDate, date: '2027-10-18' }, 'due 18/10/2026', 'fr')).toBe(
      false,
    );
  });

  it('text and an entity name found in the normalised quote', () => {
    expect(supports('text', 'Synthetic Energy', 'SYNTHETIC  ENERGY S.A.')).toBe(true);
    expect(supports('text', 'SYN-2026-001', 'Invoice SYN‑2026‑001')).toBe(true);
    expect(supports('text', 'Synthétique', 'Synthetique')).toBe(false);
  });

  it('an identifier found in the quote once both are compacted', () => {
    expect(supports('identifier', 'FR76 3000 6000 0112', 'IBAN FR7630006000-0112')).toBe(true);
    expect(supports('identifier', 'pdl-000123', 'Meter PDL 000123')).toBe(true);
    expect(supports('identifier', '---', 'Meter ---')).toBe(false);
  });

  it('an enum value found in the quote, an underscore read as a space', () => {
    expect(supports('enum', 'gas', 'Energy: Gas')).toBe(true);
    expect(supports('enum', 'dual_fuel', 'Your dual fuel contract')).toBe(true);
    expect(supports('enum', 'electricity', 'Électricité')).toBe(false);
  });

  it('nothing to check for a boolean or the language of the document', () => {
    expect(supports('unchecked', true, 'Direct debit')).toBe(true);
  });
});

// The order of the day and the month in a numeric date follows the language of the
// document: day first everywhere but in English, where only a reading that cannot be
// the other one is accepted.
describe('a numeric date that both orders could read', () => {
  it('is read day first in a language that writes the day first', () => {
    expect(supports('date', '2026-04-03', '03/04/2026', 'fr')).toBe(true);
    expect(supports('date', '2026-03-04', '03/04/2026', 'fr')).toBe(false);
  });

  it('is refused in English, or when the language is unknown', () => {
    expect(supports('date', '2026-04-03', '03/04/2026', 'en')).toBe(false);
    expect(supports('date', '2026-03-04', '03/04/2026', 'en')).toBe(false);
    expect(supports('date', '2026-04-03', '03/04/2026', undefined)).toBe(false);
    expect(supports('date', '2026-04-04', '04/04/2026', 'en')).toBe(true);
  });
});

describe('factSupport', () => {
  const fact = (text: string, quote: string, extra: object = {}) => ({
    text,
    quote,
    page: 1,
    confidence: 0.9,
    ...extra,
  });

  it('drops a fact behind a quote too short to say anything', () => {
    expect(factSupport(fact('The contract was terminated.', 'Invoice'), 'en')).toBeUndefined();
  });

  it('drops a fact about an entity its quote does not name', () => {
    const quote = 'The contract is terminated as of today';
    expect(
      factSupport(
        fact('Synthetic Energy terminated the contract.', quote, {
          entities: ['Synthetic Energy'],
        }),
        'en',
      ),
    ).toBeUndefined();
  });

  it('drops a fact that states a date or a number its quote does not', () => {
    const quote = 'Contract renewed on 1 March 2026 for 12 months';
    expect(factSupport(fact('Renewed on 1 March 2027.', quote), 'en')).toBeUndefined();
    // Every number of this one is in the quote; the date it makes is not.
    expect(factSupport(fact('Renewed on 12 March 2026.', quote), 'en')).toBeUndefined();
    expect(factSupport(fact('Renewed for 24 months.', quote), 'en')).toBeUndefined();
    expect(factSupport(fact('The fee is 84,20 EUR.', quote), 'en')).toBeUndefined();
  });

  it('keeps a fact its quote supports, and only the validity its quote states', () => {
    const quote = 'Synthetic Energy renewed the contract on 1 March 2026 for 12 months';
    const kept = factSupport(
      fact('Synthetic Energy renewed the contract on 2026-03-01 for 12 months.', quote, {
        entities: ['Synthetic Energy'],
        valid_from: '2026-03-01',
        valid_to: '2027-02-28',
      }),
      'en',
    );
    expect(kept).toMatchObject({ valid_from: '2026-03-01' });
    expect(kept).not.toHaveProperty('valid_to');
  });
});
