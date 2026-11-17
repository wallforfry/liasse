import type { KeyDate } from '@liasse/contract/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_IBAN } from '../entities/support.test-helper.ts';
import { InvalidKnowledgeError, parseKnowledge } from './input.ts';
import { planKeyDates, planManualKeyDates, typesComputedNoticeDeadline } from './key-dates.ts';
import { keyDate, knowledge, TRACE } from './support.test-helper.ts';

const TWO_MONTHS = { amount: 2, unit: 'months', confidence: 0.5 } as const;

describe('planKeyDates', () => {
  it('computes the notice deadline from the renewal date and the notice period', () => {
    const rows = planKeyDates(
      [keyDate('renewal', '2027-03-01', 'Automatic renewal'), keyDate('due', '2026-10-18', 'Due')],
      TWO_MONTHS,
    );
    expect(rows).toEqual([
      { kind: 'renewal', date: '2027-03-01', label: 'Automatic renewal', ...TRACE, manual: false },
      { kind: 'due', date: '2026-10-18', label: 'Due', ...TRACE, manual: false },
      {
        kind: 'notice_deadline',
        date: '2027-01-01',
        label: 'Notice deadline: 2 months before Automatic renewal',
        model: null,
        schemaVersion: TRACE.schemaVersion,
        page: null,
        quote: null,
        confidence: 0.5,
        manual: false,
      },
    ]);
  });

  it('is as sure as the less sure of the renewal date and the notice period', () => {
    const [, computed] = planKeyDates(
      [keyDate('renewal', '2027-03-01', 'Renewal', { confidence: 0.25 })],
      TWO_MONTHS,
    );
    expect(computed?.confidence).toBe(0.25);
  });

  it('drops the notice deadline the model proposed when it can compute one', () => {
    const rows = planKeyDates(
      [
        keyDate('notice_deadline', '2027-02-14', 'Hallucinated deadline'),
        keyDate('renewal', '2027-03-01', 'Renewal'),
        keyDate('notice_deadline', '2027-01-01', 'Right by luck'),
      ],
      TWO_MONTHS,
    );
    expect(rows.map(({ kind, date, model }) => [kind, date, model])).toEqual([
      ['renewal', '2027-03-01', TRACE.model],
      ['notice_deadline', '2027-01-01', null],
    ]);
  });

  it('keeps what the model proposed when no computation is possible', () => {
    const proposed = keyDate('notice_deadline', '2027-02-14', 'Stated in the contract');
    const extracted = { ...proposed, manual: false };
    expect(planKeyDates([proposed], TWO_MONTHS)).toEqual([extracted]);
    const renewal = keyDate('renewal', '2027-03-01', 'Renewal');
    expect(planKeyDates([proposed, renewal], undefined)).toEqual([
      extracted,
      { ...renewal, manual: false },
    ]);
  });

  it('computes from the renewal date only, never from an expiry', () => {
    const rows = planKeyDates([keyDate('expiry', '2027-03-01', 'End of validity')], TWO_MONTHS);
    expect(rows.map(({ kind }) => kind)).toEqual(['expiry']);
  });

  it('computes one deadline per renewal date, and writes a single unit in the singular', () => {
    const rows = planKeyDates(
      [keyDate('renewal', '2027-03-31', 'First'), keyDate('renewal', '2028-03-31', 'Second')],
      { amount: 1, unit: 'months', confidence: 1 },
    );
    expect(rows.filter(({ kind }) => kind === 'notice_deadline')).toMatchObject([
      { date: '2027-02-28', label: 'Notice deadline: 1 month before First' },
      { date: '2028-02-29', label: 'Notice deadline: 1 month before Second' },
    ]);
  });

  it('keeps a kind once per date', () => {
    const rows = planKeyDates(
      [
        keyDate('due', '2026-10-18', 'First reading'),
        keyDate('due', '2026-10-18', 'Second reading'),
        keyDate('event', '2026-10-18', 'Another kind'),
      ],
      undefined,
    );
    expect(rows.map(({ label }) => label)).toEqual(['First reading', 'Another kind']);
  });

  it('masks an IBAN written in a label or a quote', () => {
    const [row] = planKeyDates(
      [
        keyDate('due', '2026-10-18', `Debit of ${SYNTHETIC_IBAN}`, {
          quote: `to be debited from ${SYNTHETIC_IBAN} on the 18th`,
        }),
      ],
      undefined,
    );
    expect(row?.label).toBe('Debit of ****0146');
    expect(row?.quote).toBe('to be debited from ****0146 on the 18th');
  });
});

describe('planManualKeyDates', () => {
  const given = (kind: KeyDate['kind'], date: string, label: string): KeyDate => ({
    kind,
    date,
    label,
  });
  const MANUAL = {
    model: null,
    schemaVersion: null,
    page: null,
    quote: null,
    confidence: null,
    manual: true,
  };

  it('writes each date as given, and computes the notice deadline of a renewal date', () => {
    const renewal = given('renewal', '2027-03-01', 'Renewal');
    const due = given('due', '2026-10-18', 'Due');
    expect(planManualKeyDates([renewal, due], TWO_MONTHS)).toEqual([
      { ...renewal, ...MANUAL },
      { ...due, ...MANUAL },
      {
        kind: 'notice_deadline',
        date: '2027-01-01',
        label: 'Notice deadline: 2 months before Renewal',
        model: null,
        schemaVersion: null,
        page: null,
        quote: null,
        // A renewal date a person gave is sure: the period alone weighs.
        confidence: 0.5,
        manual: false,
      },
    ]);
  });

  it('computes nothing over a notice deadline a person gave, nor without a notice period', () => {
    const renewal = given('renewal', '2027-03-01', 'Renewal');
    const deadline = given('notice_deadline', '2027-02-14', 'Notice');
    expect(planManualKeyDates([renewal, deadline], TWO_MONTHS)).toEqual([
      { ...renewal, ...MANUAL },
      { ...deadline, ...MANUAL },
    ]);
    expect(planManualKeyDates([renewal], undefined)).toEqual([{ ...renewal, ...MANUAL }]);
  });

  it('says when a notice deadline a person gives is one the rules compute', () => {
    const renewal = given('renewal', '2027-03-01', 'Renewal');
    const deadline = given('notice_deadline', '2027-02-14', 'Notice');
    expect(typesComputedNoticeDeadline([renewal, deadline], TWO_MONTHS)).toBe(true);
    expect(typesComputedNoticeDeadline([renewal, deadline], undefined)).toBe(false);
    expect(typesComputedNoticeDeadline([deadline], TWO_MONTHS)).toBe(false);
    expect(typesComputedNoticeDeadline([renewal], TWO_MONTHS)).toBe(false);
  });
});

describe('the knowledge input', () => {
  it('drops a notice period that is not a valid amount and unit, counts it, and keeps the rest', () => {
    const due = keyDate('due', '2026-10-18', 'Due');
    const parse = (noticePeriod: unknown) =>
      parseKnowledge({ ...knowledge({ keyDates: [due] }), noticePeriod });
    expect(parse({ amount: 2, unit: 'months', confidence: 1 })).toMatchObject({
      noticePeriod: { amount: 2, unit: 'months' },
      rejectedValues: 0,
    });
    for (const invalid of [
      { amount: 0, unit: 'months', confidence: 1 },
      { amount: -2, unit: 'months', confidence: 1 },
      { amount: 1.5, unit: 'months', confidence: 1 },
      { amount: 2, unit: 'years', confidence: 1 },
      { amount: 2, unit: 'months', confidence: 2 },
      '2 months',
    ]) {
      const parsed = parse(invalid);
      expect(parsed.noticePeriod).toBeUndefined();
      expect(parsed.rejectedValues).toBe(1);
      expect(parsed.keyDates).toEqual([due]);
    }
    expect(parse(undefined)).toMatchObject({ rejectedValues: 0 });
  });

  it.each([
    ['months', 60, true],
    ['months', 61, false],
    ['weeks', 260, true],
    ['weeks', 261, false],
    ['days', 1826, true],
    ['days', 1827, false],
  ] as const)('bounds a notice period in %s at five years: %i kept %s', (unit, amount, kept) => {
    const parsed = parseKnowledge({
      ...knowledge(),
      noticePeriod: { amount, unit, confidence: 1 },
    });
    expect(parsed.noticePeriod !== undefined).toBe(kept);
    expect(parsed.rejectedValues).toBe(kept ? 0 : 1);
  });

  it('refuses a date that is not a calendar date, and never echoes a rejected value', () => {
    const invalid = knowledge({ keyDates: [keyDate('due', '2026-02-30', 'Secret label 4242')] });
    expect(() => parseKnowledge(invalid)).toThrow(InvalidKnowledgeError);
    expect(() => parseKnowledge(invalid)).not.toThrow(/Secret label|2026-02-30/);
  });

  it('refuses more than five facts, and a fact that ends before it starts', () => {
    const one = { text: 'A fact.', validFrom: null, validTo: null, entityIds: [], subjects: [] };
    const six = Array.from({ length: 6 }, () => ({ ...one, ...TRACE }));
    expect(() => parseKnowledge(knowledge({ facts: six.slice(0, 5) }))).not.toThrow();
    expect(() => parseKnowledge(knowledge({ facts: six }))).toThrow(InvalidKnowledgeError);
    const backwards = { ...one, ...TRACE, validFrom: '2026-02-01', validTo: '2026-01-01' };
    expect(() => parseKnowledge(knowledge({ facts: [backwards] }))).toThrow(InvalidKnowledgeError);
  });

  it('refuses a key it does not know', () => {
    expect(() => parseKnowledge({ ...knowledge(), links: [] })).toThrow(InvalidKnowledgeError);
  });
});
