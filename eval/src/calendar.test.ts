import { describe, expect, it } from 'vitest';
import { addDays, addMonths, noticeDeadline } from './calendar.ts';

describe('calendar arithmetic', () => {
  it.each([
    ['2026-03-01', -2, '2026-01-01'],
    ['2024-03-01', -2, '2024-01-01'],
    ['2025-01-15', -2, '2024-11-15'],
    ['2025-03-31', -1, '2025-02-28'],
    ['2024-03-31', -1, '2024-02-29'],
    ['2025-06-01', 12, '2026-06-01'],
    ['2024-02-29', 12, '2025-02-28'],
    ['2025-12-31', 2, '2026-02-28'],
  ])('moves %s by %i months to %s', (from, months, to) => {
    expect(addMonths(from, months)).toBe(to);
  });

  it('moves a date by days across months and years', () => {
    expect(addDays('2026-06-01', -1)).toBe('2026-05-31');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('gives the last day to give notice as the renewal minus the notice period', () => {
    expect(noticeDeadline('2026-03-01', 2)).toBe('2026-01-01');
    expect(noticeDeadline('2026-05-31', 3)).toBe('2026-02-28');
  });
});
