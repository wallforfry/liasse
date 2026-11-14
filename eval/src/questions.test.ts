import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus, loadQuestions } from './corpus.ts';
import type { Corpus, Expectation, GroundTruth, Question, QuestionSet } from './schema/index.ts';
import { createCorpusIndex, scoreAnswer } from './score/index.ts';
import { oracleAnswer } from './score/oracle.test-helper.ts';

let corpus: Corpus;
let questions: QuestionSet;

beforeAll(async () => {
  [corpus, questions] = await Promise.all([loadCorpus(), loadQuestions()]);
});

const question = (id: string): Question => {
  const found = questions.questions.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No question ${id}`);
  return found;
};

const stated = <Value>(expectation: Expectation<Value>): Value | undefined =>
  expectation.requirement === 'forbidden' ? undefined : expectation.value;

// What a correct archive holds: one document per distinct file.
const archive = (): readonly GroundTruth[] =>
  corpus.documents.filter(({ duplicate_of }) => duplicate_of === null);

const ofType = (category: string): readonly GroundTruth[] =>
  archive().filter(({ type }) => type.category === category);

const datedWithin = (document: GroundTruth, from: string, to: string): boolean => {
  const date = stated(document.core.document_date);
  return date !== undefined && date >= from && date <= to;
};

const total = (documents: readonly GroundTruth[]): number =>
  Math.round(
    documents.reduce((sum, { core }) => sum + (stated(core.amount)?.value ?? 0), 0) * 100,
  ) / 100;

const DEADLINE_KINDS: readonly string[] = ['expiry', 'renewal', 'notice_deadline'];

const ids = (documents: readonly GroundTruth[]): readonly string[] =>
  documents.map(({ id }) => id).sort();

// Each expected answer is computed again from the ground truth, by the reading the
// question intends: a question and the truth cannot disagree without a test failing.
describe('the expected answers, recomputed from the ground truth', () => {
  it('q01 sums the electricity bills dated 2025', () => {
    const bills = ofType('energy_bill').filter((bill) =>
      datedWithin(bill, '2025-01-01', '2025-12-31'),
    );
    const { amounts, counts, documents } = question('q01').expected;
    expect(amounts[0]?.value).toEqual({ value: total(bills), currency: 'EUR' });
    expect(counts[0]?.value).toBe(bills.length);
    expect([...documents.optional].sort()).toEqual(ids(bills));
  });

  it('q01 would be wrong if the byte-identical copy counted', () => {
    const withCopies = corpus.documents.filter(
      (document) =>
        document.type.category === 'energy_bill' &&
        datedWithin(document, '2025-01-01', '2025-12-31'),
    );
    expect(total(withCopies)).toBeGreaterThan(
      question('q01').expected.amounts[0]?.value.value ?? 0,
    );
  });

  it('q03 lists the current contracts with a date in the first quarter of 2026', () => {
    const ended = new Set(
      corpus.documents.flatMap(({ links }) =>
        links
          .filter(({ kind }) => kind === 'terminates' || kind === 'supersedes')
          .map(({ target }) => target),
      ),
    );
    const due = archive().filter(
      ({ id, key_dates }) =>
        !ended.has(id) &&
        key_dates.some(
          ({ kinds, expectation }) =>
            expectation.requirement === 'required' &&
            kinds.some((kind) => DEADLINE_KINDS.includes(kind)) &&
            expectation.value >= '2026-01-01' &&
            expectation.value <= '2026-03-31',
        ),
    );
    const { documents } = question('q03').expected;
    expect(ids(due)).toEqual(
      [...documents.required, ...documents.any_of.map(([first = '']) => first)].sort(),
    );
    expect(documents.forbidden.filter((id) => !ended.has(id))).toEqual(['car-insurance-2025']);
  });

  it('q05 lists the documents about the car, and not the rented one', () => {
    const about = (requirement: string): readonly GroundTruth[] =>
      archive().filter(({ subjects }) =>
        subjects.some(
          (subject) => subject.subject === 'car' && subject.requirement === requirement,
        ),
      );
    const { documents } = question('q05').expected;
    const originals = about('required').filter(
      ({ near_duplicate_of }) => near_duplicate_of === null,
    );
    expect([...documents.required].sort()).toEqual(ids(originals));
    expect([...documents.forbidden].sort()).toEqual(ids(about('forbidden')));
  });

  it('q06 lists the documents issued by Brisevent', () => {
    const issued = archive().filter(({ core }) => stated(core.issuer) === 'brisevent');
    expect([...question('q06').expected.documents.required].sort()).toEqual(ids(issued));
  });

  it('q07 sums the mobile bills dated September to November 2025', () => {
    const bills = ofType('mobile_bill').filter((bill) =>
      datedWithin(bill, '2025-09-01', '2025-11-30'),
    );
    const { amounts, counts } = question('q07').expected;
    expect(amounts[0]?.value).toEqual({ value: total(bills), currency: 'EUR' });
    expect(counts[0]?.value).toBe(bills.length);
  });

  it('q14 lists the documents dated August 2025 that are not private', () => {
    const dated = archive().filter((document) => datedWithin(document, '2025-08-01', '2025-08-31'));
    const { documents } = question('q14').expected;
    expect([...documents.required].sort()).toEqual(
      ids(dated.filter((document) => document.private !== 'required')),
    );
    expect([...documents.forbidden].sort()).toEqual(
      ids(dated.filter((document) => document.private === 'required')),
    );
  });

  it('q16 lists the documents whose amount is not in euros', () => {
    const foreign = archive().filter(({ core }) => {
      const amount = stated(core.amount);
      return amount !== undefined && amount.currency !== 'EUR';
    });
    const { documents, amounts } = question('q16').expected;
    expect([...documents.required].sort()).toEqual(ids(foreign));
    expect(amounts.map(({ value }) => value)).toEqual(
      expect.arrayContaining(foreign.map(({ core }) => stated(core.amount))),
    );
  });

  it('q20 counts the electricity bills of each supplier', () => {
    const bills = ofType('energy_bill');
    const { counts, entities } = question('q20').expected;
    expect(counts.map(({ key, value }) => [key, value])).toEqual(
      entities.required.map((issuer) => [
        issuer,
        bills.filter(({ core }) => stated(core.issuer) === issuer).length,
      ]),
    );
  });

  it('every other date and amount a question expects is stated by a document it cites', () => {
    const unsupported = questions.questions.flatMap(({ id, expected }) => {
      const cited = [...expected.documents.required, ...expected.documents.any_of.flat()];
      if (cited.length === 0) return [];
      // Only what the truth expects of the cited documents, with the quotes: a date that
      // survives in the free text of a fact or of a page supports nothing.
      const text = JSON.stringify(
        corpus.documents
          .filter((document) => cited.includes(document.id))
          .map(({ core, fields, key_dates }) => ({ core, fields, key_dates })),
      );
      return [
        ...expected.dates
          .filter(({ date }) => !text.includes(date))
          .map(({ date }) => `${id}: ${date}`),
        ...expected.amounts
          .filter(
            ({ value }) =>
              !text.includes(`"value":${String(value.value)},"currency":"${value.currency}"`),
          )
          .map(({ value }) => `${id}: ${String(value.value)}`),
      ];
    });
    expect(unsupported).toEqual([]);
  });
});

describe('the answers that state what the questions expect', () => {
  it('pass, all twenty of them', () => {
    const index = createCorpusIndex(corpus);
    const scores = questions.questions.map((asked) =>
      scoreAnswer(asked, oracleAnswer(asked, index), index),
    );
    expect(scores.filter(({ pass }) => !pass)).toEqual([]);
    expect(scores).toHaveLength(20);
  });
});
