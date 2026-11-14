import { describe, expect, it } from 'vitest';
import { subtractPeriod } from './notice-deadline.ts';

describe('subtractPeriod', () => {
  it.each([
    ['2027-03-01', 2, 'months', '2027-01-01'],
    ['2027-03-31', 2, 'months', '2027-01-31'],
    ['2027-03-31', 1, 'months', '2027-02-28'],
    ['2028-03-31', 1, 'months', '2028-02-29'],
    ['2028-03-30', 1, 'months', '2028-02-29'],
    ['2027-04-30', 2, 'months', '2027-02-28'],
    ['2027-05-31', 1, 'months', '2027-04-30'],
    ['2027-01-15', 1, 'months', '2026-12-15'],
    ['2027-02-10', 14, 'months', '2025-12-10'],
    ['2027-01-31', 12, 'months', '2026-01-31'],
    ['2028-02-29', 12, 'months', '2027-02-28'],
    ['2100-03-31', 1, 'months', '2100-02-28'],
    ['2000-03-31', 1, 'months', '2000-02-29'],
  ] as const)('%s minus %i %s is %s', (date, amount, unit, expected) => {
    expect(subtractPeriod(date, { amount, unit })).toBe(expected);
  });

  it.each([
    ['2027-03-01', 30, 'days', '2027-01-30'],
    ['2028-03-01', 1, 'days', '2028-02-29'],
    ['2027-03-01', 1, 'days', '2027-02-28'],
    ['2027-01-01', 1, 'days', '2026-12-31'],
    ['2027-01-10', 2, 'weeks', '2026-12-27'],
    ['2027-03-15', 8, 'weeks', '2027-01-18'],
    ['2027-10-31', 90, 'days', '2027-08-02'],
  ] as const)('%s minus %i %s is %s', (date, amount, unit, expected) => {
    expect(subtractPeriod(date, { amount, unit })).toBe(expected);
  });

  it('does not depend on the time zone of the process', () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Paris']) {
        process.env.TZ = zone;
        expect(subtractPeriod('2027-03-31', { amount: 1, unit: 'days' })).toBe('2027-03-30');
        expect(subtractPeriod('2027-03-31', { amount: 2, unit: 'months' })).toBe('2027-01-31');
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('gives nothing for a date before the years an ISO date writes', () => {
    expect(subtractPeriod('1000-01-15', { amount: 1, unit: 'months' })).toBeUndefined();
    expect(subtractPeriod('1000-01-01', { amount: 1, unit: 'days' })).toBeUndefined();
    expect(subtractPeriod('1000-02-01', { amount: 1, unit: 'months' })).toBe('1000-01-01');
  });
});
