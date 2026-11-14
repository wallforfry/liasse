import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES } from './languages.ts';
import {
  currencyCodeSchema,
  isoDateSchema,
  keyDateSchema,
  languageCodeSchema,
  moneySchema,
  periodSchema,
} from './values.ts';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('isoDateSchema', () => {
  it.each(['2026-10-03', '2024-02-29', '1999-12-31'])('accepts the calendar date %s', (date) => {
    expect(accepts(isoDateSchema, date)).toBe(true);
  });

  it.each([
    '2026-02-30',
    '2023-02-29',
    '2026-13-01',
    '2026-04-31',
    '2026-1-01',
    '03/10/2026',
    '2026-10-03T00:00:00Z',
    '',
  ])('rejects %s, which is not a calendar date as YYYY-MM-DD', (date) => {
    expect(accepts(isoDateSchema, date)).toBe(false);
  });

  it('rejects a Date object', () => {
    expect(accepts(isoDateSchema, new Date('2026-10-03'))).toBe(false);
  });
});

describe('periodSchema', () => {
  it('accepts a period that ends after it starts, or on the same day', () => {
    expect(accepts(periodSchema, { start: '2026-09-01', end: '2026-09-30' })).toBe(true);
    expect(accepts(periodSchema, { start: '2026-09-01', end: '2026-09-01' })).toBe(true);
  });

  it('rejects a period that ends before it starts', () => {
    const result = periodSchema.safeParse({ start: '2026-09-30', end: '2026-09-01' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path)).toEqual([['end']]);
  });

  it('rejects a missing bound, an invalid date and an unknown key', () => {
    expect(accepts(periodSchema, { start: '2026-09-01' })).toBe(false);
    expect(accepts(periodSchema, { start: '2026-09-01', end: '2026-09-31' })).toBe(false);
    expect(accepts(periodSchema, { start: '2026-09-01', end: '2026-09-30', label: 'x' })).toBe(
      false,
    );
  });
});

describe('moneySchema', () => {
  it('accepts a value with an ISO 4217 currency', () => {
    expect(accepts(moneySchema, { value: 84.2, currency: 'EUR' })).toBe(true);
    expect(accepts(moneySchema, { value: -12, currency: 'USD' })).toBe(true);
  });

  it.each(['ZZZ', 'eur', 'EURO', '€', ''])('rejects the currency %s', (currency) => {
    expect(accepts(currencyCodeSchema, currency)).toBe(false);
    expect(accepts(moneySchema, { value: 1, currency })).toBe(false);
  });

  it('rejects a value that is not a finite number, a missing currency and an unknown key', () => {
    expect(accepts(moneySchema, { value: '84.20', currency: 'EUR' })).toBe(false);
    expect(accepts(moneySchema, { value: Number.POSITIVE_INFINITY, currency: 'EUR' })).toBe(false);
    expect(accepts(moneySchema, { value: 84.2 })).toBe(false);
    expect(accepts(moneySchema, { value: 84.2, currency: 'EUR', tax: 1 })).toBe(false);
  });
});

describe('languageCodeSchema', () => {
  it('accepts ISO 639-1 codes', () => {
    expect(accepts(languageCodeSchema, 'fr')).toBe(true);
    expect(accepts(languageCodeSchema, 'en')).toBe(true);
  });

  it.each(['fra', 'FR', 'xx', 'iw', ''])('rejects %s', (code) => {
    expect(accepts(languageCodeSchema, code)).toBe(false);
  });

  it('lists every code once, and only codes the runtime knows as languages', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
    expect(LANGUAGE_CODES.filter((code) => names.of(code) === undefined)).toEqual([]);
    expect(LANGUAGE_CODES).toHaveLength(184);
  });
});

describe('keyDateSchema', () => {
  it('accepts a kind, a calendar date and a label', () => {
    expect(accepts(keyDateSchema, { kind: 'renewal', date: '2027-03-01', label: 'Renewal' })).toBe(
      true,
    );
  });

  it('rejects an unknown kind, an invalid date and an empty label', () => {
    expect(accepts(keyDateSchema, { kind: 'birthday', date: '2027-03-01', label: 'x' })).toBe(
      false,
    );
    expect(accepts(keyDateSchema, { kind: 'renewal', date: '2027-02-30', label: 'x' })).toBe(false);
    expect(accepts(keyDateSchema, { kind: 'renewal', date: '2027-03-01', label: '' })).toBe(false);
  });
});
