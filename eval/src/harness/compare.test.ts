import { describe, expect, it } from 'vitest';
import { aggregateReport, type Judgement } from '../score/index.ts';
import { compareReports, parseReport } from './compare.ts';

const judged = (item: string, outcome: Judgement['outcome']): Judgement => ({
  item,
  requirement: 'required',
  outcome,
});

const reportOf = (label: string, issuer: Judgement['outcome'], pass: boolean) =>
  parseReport({
    label,
    models: { text_model: `${label}-text`, vision_model: 'vision', embedding_model: 'e5' },
    documents: {
      totals: aggregateReport([
        {
          kind: 'scored',
          id: 'lease',
          duplicate: judged('duplicate of nothing', 'absent'),
          type: 'exact',
          core: [judged('issuer', issuer)],
          fields: [],
          key_dates: [],
          links: [],
          subjects: [],
          facts: [],
          private: null,
          masking: [],
          transcription: [],
        },
      ]),
    },
    questions: {
      passed: pass ? 1 : 0,
      total: 1,
      results: [{ id: 'q01', pass, reasons: pass ? [] : ['total: no amount (total)'] }],
    },
  });

describe('compareReports', () => {
  it('puts two runs side by side, totals, fields and questions', () => {
    const table = compareReports([
      reportOf('before', 'missing', false),
      reportOf('after', 'correct', true),
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toBe('| Totals | before | after |');
    expect(lines).toContain('| Text model | before-text | after-text |');
    expect(lines).toContain('| Questions passed | 0/1 | 1/1 |');
    expect(lines).toContain('| core issuer P / R | - / 0.00 | 1.00 / 1.00 |');
    expect(lines).toContain('| q01 | fail: total: no amount (total) | pass |');
  });

  it('refuses a file that is no run report', () => {
    expect(() => parseReport({ label: 'x' })).toThrow();
  });
});
