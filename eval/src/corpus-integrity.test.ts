import { KEY_DATE_KINDS, LINK_KINDS, SUPPORTED_MIMES, entityNameKey } from '@liasse/core/domain';
import { CORE_FIELDS, fieldNameViolations, slugViolations } from '@liasse/core/registry';
import { beforeAll, describe, expect, it } from 'vitest';
import { noticeDeadline } from './calendar.ts';
import { loadCorpus, loadQuestions } from './corpus.ts';
import {
  CORE_TRUTH_VALUES,
  type Corpus,
  type GroundTruth,
  HARD_CASES,
  type QuestionSet,
} from './schema/index.ts';

let corpus: Corpus;
let questions: QuestionSet;

beforeAll(async () => {
  [corpus, questions] = await Promise.all([loadCorpus(), loadQuestions()]);
});

const stated = <Value>(expectation: {
  readonly requirement: string;
  readonly value?: Value;
  readonly also?: readonly Value[] | undefined;
}): readonly Value[] =>
  expectation.value === undefined ? [] : [expectation.value, ...(expectation.also ?? [])];

const unknownAmong = (keys: readonly string[], known: ReadonlySet<string>): readonly string[] =>
  [...new Set(keys)].filter((key) => !known.has(key));

const NOTICE_FIELD = 'notice_period_months';

interface NoticeDeadlineCheck {
  readonly id: string;
  readonly stated: string | undefined;
  readonly computed: string;
}

// The specification computes the last day to give notice: the renewal minus the notice
// period. Every record that states a renewal and a notice period is held to that day.
const noticeDeadlineChecks = (documents: readonly GroundTruth[]): readonly NoticeDeadlineCheck[] =>
  documents.flatMap(({ id, fields, key_dates }) => {
    const months = fields
      .filter(({ names }) => names.includes(NOTICE_FIELD))
      .flatMap(({ expectation }) => stated(expectation))
      .find((value) => typeof value === 'number');
    const dateOf = (kind: string): string | undefined =>
      key_dates
        .filter(({ kinds }) => kinds[0] === kind)
        .flatMap(({ expectation }) => stated(expectation))[0];
    const renewal = dateOf('renewal');
    return months === undefined || renewal === undefined
      ? []
      : [{ id, stated: dateOf('notice_deadline'), computed: noticeDeadline(renewal, months) }];
  });

const wrongNoticeDeadlines = (documents: readonly GroundTruth[]): readonly NoticeDeadlineCheck[] =>
  noticeDeadlineChecks(documents).filter((check) => check.stated !== check.computed);

describe('the ground truth', () => {
  it('describes 50 files and the one document an email carries', () => {
    const files = corpus.documents.filter(({ source }) => source.kind === 'file');
    const attachments = corpus.documents.filter(({ source }) => source.kind === 'attachment');
    expect([files.length, attachments.length]).toEqual([50, 1]);
    expect(new Set(corpus.documents.map(({ id }) => id)).size).toBe(corpus.documents.length);
  });

  it('states the common core of the registry, field for field', () => {
    expect(Object.keys(CORE_TRUTH_VALUES)).toEqual(Object.keys(CORE_FIELDS));
    expect(corpus.documents.map(({ core }) => Object.keys(core).sort())).toEqual(
      corpus.documents.map(() => Object.keys(CORE_FIELDS).sort()),
    );
  });

  it('only points at documents, entities and subjects of the corpus', () => {
    const documents = new Set(corpus.documents.map(({ id }) => id));
    const entities = new Set(corpus.entities.map(({ key }) => key));
    const subjects = new Set(corpus.subjects.map(({ key }) => key));
    const pointers = (document: GroundTruth) => ({
      documents: [
        ...document.links.map(({ target }) => target),
        ...(document.duplicate_of === null ? [] : [document.duplicate_of]),
        ...(document.near_duplicate_of === null ? [] : [document.near_duplicate_of]),
        ...(document.source.kind === 'attachment' ? [document.source.of] : []),
      ],
      entities: [
        ...stated(document.core.issuer),
        ...stated(document.core.recipient),
        ...document.facts.flatMap((fact) => fact.entities),
      ],
      subjects: [
        ...document.subjects.map(({ subject }) => subject),
        ...document.facts.flatMap((fact) => fact.subjects),
      ],
    });
    const all = corpus.documents.map(pointers);
    expect(
      unknownAmong(
        all.flatMap((pointer) => pointer.documents),
        documents,
      ),
    ).toEqual([]);
    expect(
      unknownAmong([corpus.owner, ...all.flatMap((pointer) => pointer.entities)], entities),
    ).toEqual([]);
    expect(
      unknownAmong(
        all.flatMap((pointer) => pointer.subjects),
        subjects,
      ),
    ).toEqual([]);
  });

  it('never links a document to itself and keeps copies apart from originals', () => {
    const selfLinked = corpus.documents.filter(({ id, links }) =>
      links.some(({ target }) => target === id),
    );
    const chained = corpus.documents.filter(
      ({ duplicate_of }) =>
        duplicate_of !== null &&
        corpus.documents.find(({ id }) => id === duplicate_of)?.duplicate_of !== null,
    );
    expect([selfLinked, chained]).toEqual([[], []]);
  });

  it('gives a byte-identical copy the hash of its original, and nothing else that hash', () => {
    const hashOf = new Map(corpus.documents.map(({ id, sha256 }) => [id, sha256]));
    const copies = corpus.documents.filter(({ duplicate_of }) => duplicate_of !== null);
    const originals = corpus.documents.filter(({ duplicate_of }) => duplicate_of === null);
    expect(copies.map(({ sha256 }) => sha256)).toEqual(
      copies.map(({ duplicate_of }) => hashOf.get(duplicate_of ?? '')),
    );
    expect(new Set(originals.map(({ sha256 }) => sha256)).size).toBe(originals.length);
  });

  it('names every entity once, whatever the spelling', () => {
    const keys = corpus.entities.flatMap(({ canonical_name, aliases }) => [
      ...new Set([canonical_name, ...aliases].map(entityNameKey)),
    ]);
    expect(keys.filter((key, position) => keys.indexOf(key) !== position)).toEqual([]);
  });

  it('uses every entity and every subject it declares', () => {
    const entities = new Set(
      corpus.documents.flatMap(({ core }) => [...stated(core.issuer), ...stated(core.recipient)]),
    );
    const subjects = new Set(
      corpus.documents.flatMap((document) => document.subjects.map(({ subject }) => subject)),
    );
    expect(corpus.entities.map(({ key }) => key).filter((key) => !entities.has(key))).toEqual([]);
    expect(corpus.subjects.map(({ key }) => key).filter((key) => !subjects.has(key))).toEqual([]);
  });

  it('expects type slugs and field names the registry would accept', () => {
    const context = {
      schemaLanguage: 'en' as const,
      entityNames: corpus.entities.flatMap(({ kind, canonical_name, aliases }) =>
        [canonical_name, ...aliases].map((name) => ({ kind, name })),
      ),
      typeSlugs: [],
    };
    const slugs = corpus.documents.flatMap(({ type }) => [
      type.category,
      ...type.acceptable,
      ...(type.parent === null ? [] : [type.parent]),
    ]);
    const names = corpus.documents.flatMap(({ fields }) => fields.flatMap((field) => field.names));
    expect([...new Set(slugs)].flatMap((slug) => slugViolations(slug, context))).toEqual([]);
    expect([...new Set(names)].flatMap(fieldNameViolations)).toEqual([]);
  });

  it('gives each type field of a document a preferred name of its own', () => {
    const repeated = corpus.documents.filter(({ fields }) => {
      const preferred = fields.map(({ names }) => names[0]);
      return new Set(preferred).size !== preferred.length;
    });
    expect(repeated.map(({ id }) => id)).toEqual([]);
  });

  it('declares the clear value of every masked field', () => {
    const undeclared = corpus.documents.flatMap(({ id, fields, masking }) =>
      fields
        .filter(
          ({ masked, expectation }) =>
            masked &&
            !masking.some(({ visible_tail }) => stated(expectation).includes(visible_tail)),
        )
        .map(({ names }) => `${id}: ${names[0] ?? ''}`),
    );
    expect(undeclared).toEqual([]);
  });

  it('states the notice deadline the renewal and the notice period give', () => {
    expect(noticeDeadlineChecks(corpus.documents).map(({ id }) => id)).toEqual([
      'home-insurance-contract',
      'home-insurance-renewal-2026',
    ]);
    expect(wrongNoticeDeadlines(corpus.documents)).toEqual([]);
  });

  it('would catch a notice deadline moved by a day, or by a month', () => {
    const moved = (id: string, to: string): readonly GroundTruth[] =>
      corpus.documents.map((document) =>
        document.id === id
          ? {
              ...document,
              key_dates: document.key_dates.map((entry) =>
                entry.kinds[0] === 'notice_deadline' &&
                entry.expectation.requirement !== 'forbidden'
                  ? { ...entry, expectation: { ...entry.expectation, value: to } }
                  : entry,
              ),
            }
          : document,
      );
    expect(wrongNoticeDeadlines(moved('home-insurance-renewal-2026', '2026-01-02'))).toEqual([
      { id: 'home-insurance-renewal-2026', stated: '2026-01-02', computed: '2026-01-01' },
    ]);
    expect(wrongNoticeDeadlines(moved('home-insurance-contract', '2023-12-01'))).toEqual([
      { id: 'home-insurance-contract', stated: '2023-12-01', computed: '2024-01-01' },
    ]);
  });

  it('states one to three facts for every document with enough text to hold one', () => {
    const without = corpus.documents.filter(
      ({ facts, hard_cases }) => facts.length === 0 && !hard_cases.includes('little_text'),
    );
    expect(without.map(({ id }) => id)).toEqual([]);
  });
});

describe('the coverage of the corpus', () => {
  const count = (matches: (document: GroundTruth) => boolean): number =>
    corpus.documents.filter(matches).length;

  it('has every supported format', () => {
    expect(new Set(corpus.documents.map(({ mime }) => mime))).toEqual(new Set(SUPPORTED_MIMES));
  });

  it('is mostly in French, with English and two other languages', () => {
    const size = (language: string): number =>
      count(({ core }) => stated(core.language).some((value) => value === language));
    expect(size('fr')).toBeGreaterThan(corpus.documents.length / 2);
    expect(size('en')).toBeGreaterThanOrEqual(3);
    expect([size('de'), size('es')]).toEqual([1, 1]);
  });

  it('has pages without a text layer, alone and beside native pages', () => {
    const methods = (document: GroundTruth) => new Set(document.pages.map(({ method }) => method));
    expect(
      count((document) => document.mime === 'application/pdf' && methods(document).size === 2),
    ).toBe(1);
    expect(
      count(
        (document) =>
          document.mime === 'application/pdf' && [...methods(document)].join() === 'vision',
      ),
    ).toBeGreaterThanOrEqual(6);
  });

  it.each(HARD_CASES)('has the hard case %s', (hardCase) => {
    expect(count(({ hard_cases }) => hard_cases.includes(hardCase))).toBeGreaterThanOrEqual(1);
  });

  it.each(LINK_KINDS)('has a required link of kind %s', (kind) => {
    expect(
      count(({ links }) =>
        links.some((link) => link.kind === kind && link.requirement === 'required'),
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it.each(KEY_DATE_KINDS)('has a key date of kind %s', (kind) => {
    expect(
      count(({ key_dates }) =>
        key_dates.some(
          ({ kinds, expectation }) => kinds[0] === kind && expectation.requirement !== 'forbidden',
        ),
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it('has subjects of every kind a household of two adults holds', () => {
    expect(new Set(corpus.subjects.map(({ kind }) => kind))).toEqual(
      new Set(['property', 'vehicle', 'contract', 'employment', 'account']),
    );
  });

  it('has documents that must be private and documents that must not', () => {
    expect(count((document) => document.private === 'required')).toBeGreaterThanOrEqual(2);
    expect(count((document) => document.private === 'forbidden')).toBeGreaterThanOrEqual(30);
  });
});

describe('the reference questions', () => {
  it('are twenty, each with its own id', () => {
    expect(questions.questions).toHaveLength(20);
    expect(new Set(questions.questions.map(({ id }) => id)).size).toBe(20);
  });

  it('share the reference date of the corpus', () => {
    expect(questions.reference_date).toBe(corpus.reference_date);
  });

  // Private documents do not surface unless asked for, so a question that does not ask
  // for them can only call for documents that must never be flagged private: a system
  // that flags a document private, where the truth allows it, and respects the flag
  // must still be able to answer.
  it('only call for documents that cannot be private, unless they ask for private ones', () => {
    const privacyOf = new Map(corpus.documents.map(({ id, private: flag }) => [id, flag]));
    const canBePrivate = (id: string): boolean => privacyOf.get(id) !== 'forbidden';
    const asksForPrivate = ({ tools }: QuestionSet['questions'][number]): boolean =>
      tools.some(
        ({ arguments: input }) => 'include_private' in input && input.include_private === true,
      );
    const conflicts = questions.questions
      .filter((question) => !asksForPrivate(question))
      .flatMap(({ id, expected: { documents } }) => [
        ...documents.required.filter(canBePrivate).map((document) => `${id}: ${document}`),
        ...documents.any_of
          .filter((group) => group.every(canBePrivate))
          .map((group) => `${id}: any of ${group.join(', ')}`),
      ]);
    expect(conflicts).toEqual([]);
  });

  it('only point at documents and entities of the corpus', () => {
    const documents = new Set(corpus.documents.map(({ id }) => id));
    const entities = new Set(corpus.entities.map(({ key }) => key));
    const cited = questions.questions.flatMap(({ expected }) => [
      ...expected.documents.required,
      ...expected.documents.any_of.flat(),
      ...expected.documents.optional,
      ...expected.documents.forbidden,
    ]);
    expect(unknownAmong(cited, documents)).toEqual([]);
    expect(
      unknownAmong(
        questions.questions.flatMap(({ expected }) => expected.entities.required),
        entities,
      ),
    ).toEqual([]);
  });

  it('never require and forbid the same document', () => {
    const contradictory = questions.questions.filter(({ expected: { documents } }) =>
      [...documents.required, ...documents.any_of.flat(), ...documents.optional].some((id) =>
        documents.forbidden.includes(id),
      ),
    );
    expect(contradictory.map(({ id }) => id)).toEqual([]);
  });

  it('use every tool an agent has to read the archive', () => {
    expect(
      new Set(questions.questions.flatMap(({ tools }) => tools.map(({ tool }) => tool))),
    ).toEqual(
      new Set([
        'search',
        'query',
        'upcoming',
        'timeline',
        'recall',
        'get_subject',
        'list_entities',
        'describe_types',
      ]),
    );
  });

  it('are asked in French and in English', () => {
    expect(new Set(questions.questions.map(({ language }) => language))).toEqual(
      new Set(['fr', 'en']),
    );
  });

  it('expect something checkable, or nothing at all', () => {
    const empty = questions.questions.filter(
      ({ expected: { documents, amounts, dates, counts, entities, verdict } }) =>
        documents.required.length +
          documents.any_of.length +
          amounts.length +
          dates.length +
          counts.length +
          entities.required.length ===
          0 &&
        verdict === null &&
        !documents.exhaustive,
    );
    expect(empty.map(({ id }) => id)).toEqual([]);
  });
});
