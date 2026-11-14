import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, loadQuestions } from '../corpus.ts';
import type { Answer, Corpus, Question, SystemDocument } from '../schema/index.ts';
import { type CorpusIndex, createCorpusIndex } from './corpus-index.ts';
import { type DocumentScore, SCORED_SECTIONS, scoreDocument } from './document.ts';
import { oracleAnswer, oracleDocument, oracleDocuments } from './oracle.test-helper.ts';
import type { Judgement } from './outcome.ts';
import { scoreAnswer } from './question.ts';
import { aggregateReport } from './report.ts';

let corpus: Corpus;
let index: CorpusIndex;
let questions: readonly Question[];

beforeAll(async () => {
  corpus = await loadCorpus();
  index = createCorpusIndex(corpus);
  ({ questions } = await loadQuestions());
});

// Scores what a system holds for a document, starting from a perfect output and changing
// the part under test.
const scored = (result: ReturnType<typeof scoreDocument>): DocumentScore => {
  if (result.kind !== 'scored') throw new Error(`Invalid output: ${result.issues.join('; ')}`);
  return result;
};

const scoreWith = (
  id: string,
  change: (perfect: SystemDocument) => Partial<SystemDocument>,
): DocumentScore => {
  const truth = index.document(id);
  const perfect = oracleDocument(truth, index);
  return scored(scoreDocument(truth, { ...perfect, ...change(perfect) }, index));
};

const outcomeOf = (judgements: readonly Judgement[], item: string): string | undefined =>
  judgements.find((judgement) => judgement.item.startsWith(item))?.outcome;

describe('scoring the ground truth against itself', () => {
  it('finds nothing missing, wrong or invented in any document', () => {
    const scores = oracleDocuments(corpus).map((output) =>
      scored(scoreDocument(index.document(output.id), output, index)),
    );
    const flawed = scores.flatMap((score) => [
      ...SCORED_SECTIONS.flatMap((section) =>
        score[section]
          .filter(({ outcome }) => outcome !== 'correct' && outcome !== 'absent')
          .map(({ item, outcome }) => `${score.id}: ${section} ${item} is ${outcome}`),
      ),
      ...(score.type === null || score.type === 'exact'
        ? []
        : [`${score.id}: type is ${score.type}`]),
      ...score.masking
        .filter(({ leakedIn }) => leakedIn.length > 0)
        .map(({ kind }) => `${score.id}: ${kind} leaked`),
      ...score.transcription
        .filter(({ f1 }) => f1 !== 1)
        .map(({ page }) => `${score.id}: page ${String(page)}`),
      ...(score.duplicate.outcome === 'correct' || score.duplicate.outcome === 'absent'
        ? []
        : [`${score.id}: duplicate ${score.duplicate.outcome}`]),
    ]);
    expect(flawed).toEqual([]);
  });

  it('reports full precision and recall for every part', () => {
    const report = aggregateReport(
      oracleDocuments(corpus).map((output) =>
        scoreDocument(index.document(output.id), output, index),
      ),
    );
    expect(report.documents).toBe(51);
    expect(report.types).toEqual({ exact: 50, acceptable: 0, parent: 0, mismatch: 0, missing: 0 });
    expect(
      Object.values(report.sections).map(({ precision, recall }) => [precision, recall]),
    ).toEqual(SCORED_SECTIONS.map(() => [1, 1]));
    expect(report.core_fields.amount).toMatchObject({
      missing: 0,
      wrong: 0,
      invented: 0,
      precision: 1,
      recall: 1,
    });
    expect(report.duplicates).toMatchObject({ correct: 1, invented: 0, missing: 0 });
    expect(report.masking.leaked).toBe(0);
    expect(report.masking.identifiers).toBeGreaterThanOrEqual(6);
    expect(report.transcription.mean_f1).toBe(1);
    expect(report.transcription.pages).toBeGreaterThanOrEqual(11);
  });
});

describe('scoreDocument', () => {
  it('judges each core field by its own rule', () => {
    const score = scoreWith('energy-bill-2025-01', ({ core }) => ({
      core: {
        ...core,
        issuer: 'voltaneige énergie SAS',
        amount: { value: 142.754, currency: 'EUR' },
        due_date: '2025-01-22',
        reference: core.reference?.toLowerCase().replace(/-/g, ' '),
      },
    }));
    expect(score.core.map(({ item, outcome }) => [item, outcome])).toEqual([
      ['document_date', 'correct'],
      ['issuer', 'correct'],
      ['recipient', 'correct'],
      ['amount', 'correct'],
      ['period', 'correct'],
      ['due_date', 'wrong'],
      ['reference', 'correct'],
      ['language', 'correct'],
    ]);
  });

  it('calls a core value the document does not contain an invention', () => {
    const score = scoreWith('lab-report-2025-06', ({ core }) => ({
      core: { ...core, amount: { value: 46, currency: 'EUR' } },
    }));
    expect(outcomeOf(score.core, 'amount')).toBe('invented');
  });

  it('accepts either of two values that are equally right', () => {
    const score = scoreWith('lease', ({ core }) => ({
      core: { ...core, issuer: 'M. Hector Vasseur' },
    }));
    expect(outcomeOf(score.core, 'issuer')).toBe('correct');
  });

  it('grades the type from exact to mismatch', () => {
    const typed = (slug: string, parent_slug: string | null = null) =>
      scoreWith('energy-bill-2025-01', () => ({ type: { slug, parent_slug } })).type;
    expect([
      typed('energy_bill'),
      typed('electricity_bill'),
      typed('bill'),
      typed('supplier_bill', 'bill'),
      typed('tax_notice'),
      scoreWith('energy-bill-2025-01', () => ({ type: null })).type,
    ]).toEqual(['exact', 'acceptable', 'parent', 'parent', 'mismatch', 'missing']);
  });

  it('finds a type field under any name the truth accepts, in the fields or in extra', () => {
    const score = scoreWith('energy-bill-2025-01', ({ fields }) => {
      const { meter_id, consumption_kwh, ...others } = fields;
      return { fields: others, extra: { pdl: meter_id, consumption: consumption_kwh } };
    });
    expect(
      score.fields.slice(0, 2).map(({ item, outcome, note }) => [item, outcome, note]),
    ).toEqual([
      ['meter_id', 'correct', undefined],
      ['consumption_kwh', 'correct', undefined],
    ]);
  });

  it('notes the name an identifier was found under when the truth does not list it', () => {
    const score = scoreWith('energy-bill-2025-01', ({ fields }) => {
      const { meter_id, ...others } = fields;
      return { fields: others, extra: { point_reference: meter_id } };
    });
    expect(score.fields[0]).toMatchObject({
      item: 'meter_id',
      outcome: 'correct',
      note: 'found as "point_reference"',
    });
  });

  it('misses a required type field and leaves an optional one alone', () => {
    const score = scoreWith('energy-bill-2025-01', () => ({ fields: {} }));
    expect(score.fields.map(({ outcome }) => outcome)).toEqual([
      'missing',
      'missing',
      'absent',
      'absent',
    ]);
  });

  it('refuses a sensitive field kept in clear and reports where it leaks', () => {
    const truth = index.document('bank-statement-2025-10');
    const clear = truth.masking[0]?.clear ?? '';
    const score = scoreWith('bank-statement-2025-10', ({ fields }) => ({
      fields: { ...fields, iban: clear },
      provenance: { iban: { quote: `IBAN : ${clear.replace(/ /g, '')}` } },
    }));
    expect(outcomeOf(score.fields, 'iban')).toBe('wrong');
    expect(score.masking).toEqual([{ kind: 'iban', leakedIn: ['fields', 'provenance'] }]);
  });

  it('accepts a key date under any of its kinds, and notes a date filed elsewhere', () => {
    const filedAs = (kind: 'expiry' | 'effective' | 'due') =>
      scoreWith('mobile-termination-letter', () => ({
        key_dates: [{ kind, date: '2025-12-31', label: 'end of the contract' }],
      })).key_dates[0];
    expect([filedAs('expiry')?.outcome, filedAs('effective')?.outcome]).toEqual([
      'correct',
      'correct',
    ]);
    expect(filedAs('due')).toMatchObject({
      outcome: 'missing',
      note: 'the date is filed as "due"',
    });
  });

  it('holds a forbidden kind of date against the system, and no other unlisted date', () => {
    const score = scoreWith('energy-contract-brisevent', ({ key_dates }) => ({
      key_dates: [
        ...key_dates,
        { kind: 'renewal', date: '2026-04-01', label: 'invented renewal' },
        { kind: 'event', date: '2025-03-12', label: 'signature' },
      ],
    }));
    expect(score.key_dates.map(({ outcome }) => outcome)).toEqual([
      'correct',
      'correct',
      'invented',
    ]);
  });

  it('counts a link the truth does not list as an invention', () => {
    const score = scoreWith('energy-bill-2025-03', () => ({
      links: [{ kind: 'supersedes', target: 'energy-bill-2025-01' }],
    }));
    expect(score.links).toEqual([
      { item: 'supersedes energy-bill-2025-01', requirement: 'forbidden', outcome: 'invented' },
    ]);
  });

  it('misses a required link that points at the wrong document', () => {
    const score = scoreWith('car-insurance-2025', () => ({
      links: [{ kind: 'supersedes', target: 'home-insurance-contract' }],
    }));
    expect(score.links.map(({ outcome }) => outcome)).toEqual(['missing', 'invented']);
  });

  it('recognises a subject by an identifier in its label, and refuses a forbidden one', () => {
    const owned = scoreWith('garage-invoice-2025-02', () => ({
      subjects: [{ kind: 'vehicle', label: 'Voiture SS 417 OU' }],
    }));
    const rented = scoreWith('car-rental-receipt-2025-07', () => ({
      subjects: [{ kind: 'vehicle', label: 'Velanta Coriol' }],
    }));
    const otherKind = scoreWith('garage-invoice-2025-02', () => ({
      subjects: [{ kind: 'contract', label: 'Voiture SS 417 OU' }],
    }));
    expect([
      owned.subjects[0]?.outcome,
      rented.subjects[0]?.outcome,
      otherKind.subjects[0]?.outcome,
    ]).toEqual(['correct', 'invented', 'missing']);
  });

  it('matches a fact on its substance, in any wording and language', () => {
    const score = scoreWith('energy-contract-brisevent', () => ({
      facts: [
        {
          text: 'À partir du 1er avril 2025, Brisevent remplace Voltaneige comme fournisseur.',
          valid_from: null,
          valid_to: null,
          entities: [],
          subjects: [],
        },
      ],
    }));
    expect(score.facts.map(({ outcome }) => outcome)).toEqual(['correct', 'correct']);
  });

  it('misses a fact that lacks one of the things it must carry', () => {
    const score = scoreWith('energy-contract-brisevent', () => ({
      facts: [
        {
          text: 'Brisevent supplies the electricity of the home.',
          valid_from: '2025-04-01',
          valid_to: null,
          entities: ['Brisevent'],
          subjects: [],
        },
      ],
    }));
    expect(score.facts.map(({ outcome }) => outcome)).toEqual(['missing', 'correct']);
  });

  it('wants the private flag where it is required and nowhere it is forbidden', () => {
    expect([
      scoreWith('tax-notice-2025', () => ({ private: false })).private?.outcome,
      scoreWith('energy-bill-2025-01', () => ({ private: true })).private?.outcome,
      scoreWith('bank-statement-2025-10', () => ({ private: true })).private?.outcome,
    ]).toEqual(['missing', 'invented', 'correct']);
  });

  it('scores nothing but recognition for a byte-identical copy', () => {
    const recognised = scoreWith('energy-bill-2025-06-copy', () => ({}));
    const kept = scoreWith('energy-bill-2025-06-copy', () => ({ duplicate_of: null }));
    expect(recognised).toMatchObject({ type: null, core: [], duplicate: { outcome: 'correct' } });
    expect(kept.duplicate.outcome).toBe('missing');
  });

  it('holds a near-duplicate merged into its original against the system', () => {
    const score = scoreWith('garage-invoice-photo', () => ({
      duplicate_of: 'garage-invoice-2025-02',
    }));
    expect(score.duplicate.outcome).toBe('invented');
  });

  it('scores the transcription of the pages without a text layer only', () => {
    const score = scoreWith('lease', ({ pages }) => ({
      pages: pages.map((page) =>
        page.page === 3 ? { ...page, text: 'Relevé des compteurs' } : { ...page, text: '' },
      ),
    }));
    expect(score.transcription.map(({ page, precision }) => [page, precision])).toEqual([[3, 1]]);
    expect(score.transcription[0]?.recall).toBeLessThan(0.1);
  });

  it('keeps an injected instruction from changing what is expected of the bill', () => {
    const obeyed = scoreWith('internet-bill-2025-10', ({ core }) => ({
      type: { slug: 'tax_notice', parent_slug: 'notice' },
      core: { ...core, amount: { value: 0, currency: 'EUR' } },
      private: true,
    }));
    expect([obeyed.type, outcomeOf(obeyed.core, 'amount'), obeyed.private?.outcome]).toEqual([
      'mismatch',
      'wrong',
      'invented',
    ]);
  });
});

describe('scoreDocument on readings a careful person could defend', () => {
  it('accepts the end of a commitment filed as an event', () => {
    const score = scoreWith('mobile-contract', ({ key_dates }) => ({
      key_dates: key_dates.map((date) =>
        date.date === '2026-02-09' ? { ...date, kind: 'event' as const } : date,
      ),
    }));
    expect(score.key_dates.map(({ outcome }) => outcome)).toEqual(['correct', 'correct']);
  });

  it.each(['car-insurance-2023', 'car-insurance-2025', 'mobile-contract'])(
    'accepts the period %s runs over, which it does not print as one',
    (id) => {
      const truth = index.document(id);
      expect(truth.core.period.requirement).toBe('optional');
      const score = scoreWith(id, () => ({}));
      expect(outcomeOf(score.core, 'period')).toBe('correct');
    },
  );

  it('accepts the end of the former contract the new supply contract prints', () => {
    const score = scoreWith('energy-contract-brisevent', ({ key_dates }) => ({
      key_dates: [
        ...key_dates.filter(({ date }) => date !== '2025-03-31'),
        { kind: 'expiry', date: '2025-03-31', label: 'former contract' },
      ],
    }));
    expect(score.key_dates.filter(({ outcome }) => outcome === 'invented')).toEqual([]);
  });

  it('accepts the bank statement paying the bills it debits', () => {
    const score = scoreWith('bank-statement-2025-10', () => ({
      links: ['mobile-bill-2025-10', 'internet-bill-2025-10', 'energy-bill-2025-10'].map(
        (target) => ({ kind: 'pays' as const, target }),
      ),
    }));
    expect(score.links.map(({ outcome }) => outcome)).toEqual(['correct', 'correct', 'correct']);
  });

  it('does not reward the indicative euro value of the franc invoice', () => {
    const score = scoreWith('furniture-invoice-1998', ({ core }) => ({
      core: { ...core, amount: { value: 739.38, currency: 'EUR' } },
    }));
    expect(outcomeOf(score.core, 'amount')).toBe('wrong');
  });
});

describe('scoreDocument on a value stored under another name', () => {
  it('finds an amount, an identifier or a date wherever it is stored', () => {
    const score = scoreWith('lease', ({ fields }) => {
      const { deposit, ...others } = fields;
      return { fields: others, extra: { caution: deposit } };
    });
    expect(score.fields.find(({ item }) => item === 'deposit')).toMatchObject({
      outcome: 'correct',
    });
  });

  it('does not take an unrelated number or flag for the expected one', () => {
    const score = scoreWith('home-insurance-contract', ({ fields }) => {
      const { notice_period_months: _months, automatic_renewal: _renewal, ...others } = fields;
      return { fields: others, extra: { copies: 2, paperless: true } };
    });
    expect(outcomeOf(score.fields, 'notice_period_months')).toBe('missing');
    expect(outcomeOf(score.fields, 'automatic_renewal')).toBe('absent');
  });

  it('compares text on whole words', () => {
    const result = (value: string) =>
      outcomeOf(
        scoreWith('vehicle-inspection-2025-02', ({ fields }) => ({
          fields: { ...fields, result: value },
        })).fields,
        'result',
      );
    expect([result('Résultat : FAVORABLE'), result('DÉFAVORABLE')]).toEqual(['correct', 'wrong']);
  });
});

const nested = (depth: number): unknown =>
  Array.from({ length: depth }).reduce<unknown>((inner) => ({ inner }), 'FR49');

describe('scoring what is not a system output', () => {
  it.each(['provenance', 'fields', 'extra'] as const)(
    'answers that a %s nested 10 000 deep is invalid, without throwing',
    (part) => {
      const truth = index.document('bank-statement-2025-10');
      const perfect = oracleDocument(truth, index);
      const deep = part === 'provenance' ? nested(10_000) : { iban: nested(10_000) };
      const result = scoreDocument(truth, { ...perfect, [part]: deep }, index);
      expect(result).toMatchObject({ kind: 'invalid', id: truth.id });
      expect(result.kind === 'invalid' ? result.issues : []).toEqual([
        expect.stringMatching(/^input: nested deeper than \d+ levels$/),
      ]);
    },
  );

  it('scores an output with a very wide value', () => {
    const truth = index.document('bank-statement-2025-10');
    const perfect = oracleDocument(truth, index);
    const wide = { lines: Array.from({ length: 300_000 }, (_, line) => String(line)) };
    expect(scoreDocument(truth, { ...perfect, extra: wide }, index)).toMatchObject({
      kind: 'scored',
    });
  });

  it('scores an output nested within the limit', () => {
    const truth = index.document('bank-statement-2025-10');
    const perfect = oracleDocument(truth, index);
    expect(scoreDocument(truth, { ...perfect, provenance: nested(40) }, index)).toMatchObject({
      kind: 'scored',
    });
  });

  it('answers that an answer nested 10 000 deep is invalid, without throwing', () => {
    const [first] = questions;
    if (first === undefined) throw new Error('No question');
    const score = scoreAnswer(
      first,
      { ...oracleAnswer(first, index), entities: nested(10_000) },
      index,
    );
    expect(score.pass).toBe(false);
    expect(score.reasons).toEqual([expect.stringMatching(/^invalid answer: input: nested deeper/)]);
  });

  it.each([
    ['nothing', null],
    ['a string', 'energy_bill'],
    ['an empty object', {}],
    ['an array', []],
  ])('answers that %s is invalid, without throwing', (_, output) => {
    const result = scoreDocument(index.document('lease'), output, index);
    expect(result).toMatchObject({ kind: 'invalid', id: 'lease' });
    expect(result.kind === 'invalid' ? result.issues.length : 0).toBeGreaterThan(0);
  });

  it('names what is wrong in an output of the right shape', () => {
    const truth = index.document('lease');
    const perfect = oracleDocument(truth, index);
    const broken = { ...perfect, core: { ...perfect.core, amount: '840 EUR' }, facts: 'none' };
    const result = scoreDocument(truth, broken, index);
    expect(result).toMatchObject({ kind: 'invalid', id: 'lease' });
    const issues = result.kind === 'invalid' ? result.issues : [];
    expect(issues.some((issue) => issue.startsWith('core.amount: '))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('facts: '))).toBe(true);
  });

  it('refuses the output of another document', () => {
    const other = oracleDocument(index.document('rent-receipt-2025-11'), index);
    expect(scoreDocument(index.document('lease'), other, index)).toMatchObject({
      kind: 'invalid',
      issues: ['id: expected "lease", the output is for "rent-receipt-2025-11"'],
    });
  });

  it('counts invalid outputs apart in the report', () => {
    const results = [
      scoreDocument(index.document('lease'), null, index),
      scoreDocument(index.document('lease'), oracleDocument(index.document('lease'), index), index),
    ];
    expect(aggregateReport(results)).toMatchObject({ documents: 1, invalid: 1 });
  });

  it.each([
    ['nothing', null],
    ['a string', 'yes'],
    ['an empty object', {}],
    ['a document that is not a list', { documents: 'lease' }],
  ])('fails an answer that is %s, with the reason', (_, answer) => {
    const [first] = questions;
    if (first === undefined) throw new Error('No question');
    const score = scoreAnswer(first, answer, index);
    expect(score.pass).toBe(false);
    expect(score.reasons[0]).toMatch(/^invalid answer: /);
  });
});

describe('scoreAnswer', () => {
  const asked = (id: string): Question => {
    const found = questions.find((question) => question.id === id);
    if (found === undefined) throw new Error(`No question ${id}`);
    return found;
  };
  const scoreWithAnswer = (id: string, change: Partial<Answer>) =>
    scoreAnswer(asked(id), { ...oracleAnswer(asked(id), index), ...change }, index);
  const eur = (key: string, value: number) => ({ key, value: { value, currency: 'EUR' } });

  it('fails an amount outside the tolerance, with the reason', () => {
    expect(scoreWithAnswer('q01', { amounts: [eur('total', 686.05)] })).toEqual({
      id: 'q01',
      pass: false,
      reasons: ['total: 686.05 EUR is not 597.15 EUR (total of the electricity bills dated 2025)'],
    });
    expect(scoreWithAnswer('q01', { amounts: [eur('total', 597.149)] }).pass).toBe(true);
  });

  it('fails an answer that gives a right and a wrong value for the same thing', () => {
    expect(
      scoreWithAnswer('q01', { amounts: [eur('total', 597.15), eur('total', 686.05)] }).pass,
    ).toBe(false);
  });

  it('fails a value that is missing under its key, even when present under another', () => {
    expect(scoreWithAnswer('q01', { amounts: [eur('sum', 597.15)] }).reasons).toEqual([
      'total: no amount (total of the electricity bills dated 2025)',
    ]);
  });

  it('binds each count to what it counts', () => {
    const swapped = scoreWithAnswer('q20', {
      counts: [
        { key: 'voltaneige', value: 3 },
        { key: 'brisevent', value: 4 },
      ],
    });
    expect(swapped.pass).toBe(false);
    expect(swapped.reasons).toHaveLength(2);
    expect(scoreWithAnswer('q20', {}).pass).toBe(true);
  });

  it('accepts any document of a group, and fails when none is cited', () => {
    expect(scoreWithAnswer('q04', { documents: ['mobile-termination-confirmation'] }).pass).toBe(
      true,
    );
    expect(scoreWithAnswer('q04', { documents: [] }).reasons).toEqual([
      'cites none of mobile-termination-letter, mobile-termination-confirmation',
    ]);
  });

  it('fails a forbidden document and, for an exhaustive list, an uncalled-for one', () => {
    const cited = oracleAnswer(asked('q05'), index).documents;
    expect(scoreWithAnswer('q05', { documents: [...cited, 'garage-invoice-photo'] }).pass).toBe(
      true,
    );
    expect(
      scoreWithAnswer('q05', { documents: [...cited, 'car-rental-receipt-2025-07'] }).reasons,
    ).toEqual(['cites car-rental-receipt-2025-07, which must stay out']);
    expect(scoreWithAnswer('q05', { documents: [...cited, 'lease'] }).reasons).toEqual([
      'cites lease, which the question does not call for',
    ]);
  });

  it('fails a private document that surfaces unasked', () => {
    expect(
      scoreWithAnswer('q14', { documents: ['energy-bill-2025-08', 'tax-notice-2025'] }).pass,
    ).toBe(false);
  });

  it('wants nothing cited when nothing is to be found', () => {
    expect(scoreWithAnswer('q13', {}).pass).toBe(true);
    expect(scoreWithAnswer('q13', { documents: ['lease'] }).pass).toBe(false);
    expect(scoreWithAnswer('q13', { verdict: true }).pass).toBe(false);
  });

  it('fails a wrong date, a wrong verdict and an unnamed entity', () => {
    expect(scoreWithAnswer('q02', { dates: [{ key: 'switch', date: '2025-03-31' }] }).pass).toBe(
      false,
    );
    expect(scoreWithAnswer('q18', { verdict: true }).pass).toBe(false);
    expect(scoreWithAnswer('q19', { entities: ['Tolvérane'] }).reasons).toEqual([
      'does not name Roulavie Assurances',
    ]);
    expect(scoreWithAnswer('q19', { entities: ['TOLVÉRANE ASSURANCES', 'Roulavie'] }).pass).toBe(
      true,
    );
  });

  it('fails an entity beyond the exact set a question expects, and allows it elsewhere', () => {
    expect(
      scoreWithAnswer('q19', {
        entities: ['Assurances Tolvérane', 'Roulavie', 'Northmere Travel Cover'],
      }).reasons,
    ).toEqual(['names Northmere Travel Cover, which the question does not call for']);
    expect(scoreWithAnswer('q02', { entities: ['Brisevent', 'Voltaneige'] }).pass).toBe(true);
  });

  it('lets an answer about the documents of Brisevent also name the supplier it replaced', () => {
    expect(scoreWithAnswer('q06', { entities: ['Brisevent', 'Voltaneige'] }).pass).toBe(true);
  });

  it('fails an exact question whose answer files a value under a key it does not have', () => {
    expect(
      scoreWithAnswer('q16', {
        amounts: [
          ...oracleAnswer(asked('q16'), index).amounts,
          { key: 'indicative-euros', value: { value: 739.38, currency: 'EUR' } },
        ],
      }).reasons,
    ).toEqual(['indicative-euros: an amount the question does not ask for']);
    expect(
      scoreWithAnswer('q20', {
        counts: [...oracleAnswer(asked('q20'), index).counts, { key: 'all', value: 7 }],
      }).pass,
    ).toBe(false);
  });

  it('leaves a value under another key alone when the question is not an exact one', () => {
    expect(
      scoreWithAnswer('q01', {
        amounts: [...oracleAnswer(asked('q01'), index).amounts, eur('with-copy', 686.05)],
      }).pass,
    ).toBe(true);
  });
});
