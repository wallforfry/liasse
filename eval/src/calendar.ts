// Calendar arithmetic on ISO dates, in UTC so that no time zone moves a day.

const toDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

const toIso = (date: Date): string => date.toISOString().slice(0, 10);

const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// The same day of the month `months` later, or earlier for a negative count. A day the
// target month does not have becomes its last day: 31 March minus one month is the last
// day of February.
export const addMonths = (iso: string, months: number): string => {
  const date = toDate(iso);
  const target = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(target / 12);
  const month = target - year * 12;
  return toIso(
    new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDayOfMonth(year, month)))),
  );
};

export const addDays = (iso: string, days: number): string => {
  const date = toDate(iso);
  return toIso(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)),
  );
};

// The last day to give notice before a renewal: the renewal minus the notice period, as
// the specification of Liasse computes it.
export const noticeDeadline = (renewal: string, noticeMonths: number): string =>
  addMonths(renewal, -noticeMonths);
