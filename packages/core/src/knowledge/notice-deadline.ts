import type { NoticePeriodUnit } from '../domain/enums.ts';

export interface Period {
  readonly amount: number;
  readonly unit: NoticePeriodUnit;
}

const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
// The years an ISO date writes with four digits.
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

const lastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const partsOf = (date: string): readonly [year: number, monthIndex: number, day: number] => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return [year, month - 1, day];
};

const toIsoDate = (date: Date): string | undefined => {
  const year = date.getUTCFullYear();
  return year < MIN_YEAR || year > MAX_YEAR ? undefined : date.toISOString().slice(0, 10);
};

/**
 * The calendar date a number of months after the given one, or before it for a negative
 * number, both as `YYYY-MM-DD`. The day of the month is kept, and a month too short for
 * it gives its last day: two months before March 31 is January 31, one month before is
 * the last day of February, the 29th in a leap year. Going back, the result is then never
 * later than the day a reader counting months would find, which is the safe side for a
 * deadline. Undefined outside the years an ISO date can write.
 */
export const shiftMonths = (date: string, months: number): string | undefined => {
  const [year, monthIndex, day] = partsOf(date);
  const total = year * MONTHS_PER_YEAR + monthIndex + months;
  const targetYear = Math.floor(total / MONTHS_PER_YEAR);
  const targetMonth = total - targetYear * MONTHS_PER_YEAR;
  return toIsoDate(
    new Date(
      Date.UTC(targetYear, targetMonth, Math.min(day, lastDayOfMonth(targetYear, targetMonth))),
    ),
  );
};

/**
 * The calendar date a period before the given one. Days and weeks are counted exactly,
 * months on the calendar (see `shiftMonths`). The computation is on UTC days: no clock
 * and no time zone take part in it.
 */
export const subtractPeriod = (date: string, { amount, unit }: Period): string | undefined => {
  if (unit === 'months') return shiftMonths(date, -amount);
  const [year, monthIndex, day] = partsOf(date);
  const days = amount * (unit === 'weeks' ? DAYS_PER_WEEK : 1);
  return toIsoDate(new Date(Date.UTC(year, monthIndex, day - days)));
};
