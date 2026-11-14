import { describe, expect, it } from 'vitest';
import { statesDuration } from './quote-durations.ts';

describe('statesDuration', () => {
  it.each([
    ['Notice period: 2 months.', 2, 'months'],
    ['a 30-day notice', 30, 'days'],
    ['un préavis de trois (3) mois', 3, 'months'],
    ['Kündigungsfrist von zwei Monaten', 2, 'months'],
    ['con un preaviso de quince días, es decir 15 días', 15, 'days'],
    ['preavviso di due settimane', 2, 'weeks'],
    ['One month’s notice', 1, 'months'],
  ] as const)('reads %j as %d %s', (quote, amount, unit) => {
    expect(statesDuration(quote, amount, unit)).toBe(true);
  });

  it.each([
    ['The contract renews on 1 March 2027.', 1, 'months'],
    ['Notice period: 2 months.', 1, 'months'],
    ['Notice period: 2 months.', 2, 'weeks'],
    ['2 renewals a month', 2, 'months'],
    ['12 months', 2, 'months'],
  ] as const)('does not read %j as %d %s', (quote, amount, unit) => {
    expect(statesDuration(quote, amount, unit)).toBe(false);
  });
});
