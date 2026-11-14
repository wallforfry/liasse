import { describe, expect, it } from 'vitest';
import { SYNTHETIC_IBAN } from '../entities/support.test-helper.ts';
import { InvalidKnowledgeError, parseKnowledge } from './input.ts';
import { planKeyDates } from './key-dates.ts';
import { keyDate, knowledge, TRACE } from './support.test-helper.ts';

const TWO_MONTHS = { amount: 2, unit: 'months', confidence: 0.5 } as const;

describe('planKeyDates', () => {
  it('computes the notice deadline from the renewal date and the notice period', () => {
    const rows = planKeyDates(
      [keyDate('renewal', '2027-03-01', 'Automatic renewal'), keyDate('due', '2026-10-18', 'Due')],
      TWO_MONTHS,
    );
    expect(rows).toEqual([
      { kind: 'renewal', date: '2027-03-01', label: 'Automatic renewal', ...TRACE },
      { kind: 'due', date: '2026-10-18', label: 'Due', ...TRACE },
      {
        kind: 'notice_deadline',
        date: '2027-01-01',
        label: 'Notice deadline: 2 months before Automatic renewal',
        model: null,
        schemaVersion: TRACE.schemaVersion,
        page: null,
        quote: null,
        confidence: 0.5,
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
    expect(planKeyDates([proposed], TWO_MONTHS)).toEqual([proposed]);
    const renewal = keyDate('renewal', '2027-03-01', 'Renewal');
    expect(planKeyDates([proposed, renewal], undefined)).toEqual([proposed, renewal]);
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

describe('the knowledge input', () => {
  it('refuses a notice period that is not an amount and a unit', () => {
    const parse = (noticePeriod: unknown) => () => parseKnowledge({ ...knowledge(), noticePeriod });
    expect(parse({ amount: 2, unit: 'months', confidence: 1 })).not.toThrow();
    expect(parse({ amount: 0, unit: 'months', confidence: 1 })).toThrow(InvalidKnowledgeError);
    expect(parse({ amount: 1.5, unit: 'months', confidence: 1 })).toThrow(InvalidKnowledgeError);
    expect(parse({ amount: 2, unit: 'years', confidence: 1 })).toThrow(InvalidKnowledgeError);
    expect(parse({ amount: 2, unit: 'months', confidence: 2 })).toThrow(InvalidKnowledgeError);
    expect(parse({ amount: 100_000, unit: 'days', confidence: 1 })).toThrow(InvalidKnowledgeError);
    expect(parse('2 months')).toThrow(InvalidKnowledgeError);
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
