import type { GroundTruth, KeyDateTruth, SystemDocument, TypeTruth } from '../schema/index.ts';
import { type CorpusIndex, labelNamesSubject } from './corpus-index.ts';
import { type Judgement, judgePresence } from './outcome.ts';

// How close the type of the system is to the one the truth expects:
// - `exact`: the slug a careful registry would give;
// - `acceptable`: another slug that says the same thing;
// - `parent`: only the parent was found, as the slug or as the parent of an unknown slug;
// - `mismatch`: another type; `missing`: no type at all.
export const TYPE_VERDICTS = ['exact', 'acceptable', 'parent', 'mismatch', 'missing'] as const;
export type TypeVerdict = (typeof TYPE_VERDICTS)[number];

export const typeVerdict = (truth: TypeTruth, type: SystemDocument['type']): TypeVerdict => {
  if (type === null) return 'missing';
  if (type.slug === truth.category) return 'exact';
  if (truth.acceptable.includes(type.slug)) return 'acceptable';
  return truth.parent !== null && [type.slug, type.parent_slug].includes(truth.parent)
    ? 'parent'
    : 'mismatch';
};

type KeyDate = SystemDocument['key_dates'][number];

const scoreKeyDate = (
  { kinds, expectation }: KeyDateTruth,
  dates: readonly KeyDate[],
): Judgement => {
  const item = kinds.join('|');
  const ofKind = dates.filter(({ kind }) => kinds.includes(kind));
  if (expectation.requirement === 'forbidden') {
    return judgePresence(item, 'forbidden', ofKind.length > 0);
  }
  const accepted = [expectation.value, ...(expectation.also ?? [])];
  const found = ofKind.some(({ date }) => accepted.includes(date));
  const elsewhere = dates.find(({ date }) => accepted.includes(date));
  const judgement = judgePresence(`${item} ${expectation.value}`, expectation.requirement, found);
  return found || elsewhere === undefined
    ? judgement
    : { ...judgement, note: `the date is filed as "${elsewhere.kind}"` };
};

// A document may carry dates the truth does not list (a contract has many): they are
// counted apart and never held against the system. Only a kind the truth forbids is.
export const scoreKeyDates = (truth: GroundTruth, output: SystemDocument): readonly Judgement[] =>
  truth.key_dates.map((expected) => scoreKeyDate(expected, output.key_dates));

const linkName = (kind: string, target: string): string => `${kind} ${target}`;

// The truth lists every link of a document to another document of the corpus: a link the
// system adds beyond them is an invention.
export const scoreLinks = (truth: GroundTruth, output: SystemDocument): readonly Judgement[] => {
  const asserted = new Set(output.links.map(({ kind, target }) => linkName(kind, target)));
  const listed = new Set(truth.links.map(({ kind, target }) => linkName(kind, target)));
  return [
    ...truth.links.map(({ kind, target, requirement }) =>
      judgePresence(linkName(kind, target), requirement, asserted.has(linkName(kind, target))),
    ),
    ...[...asserted]
      .filter((link) => !listed.has(link))
      .map((link) => judgePresence(link, 'forbidden', true)),
  ];
};

// Subjects the truth does not list are left alone: a system may well open a file the
// scenario did not think of. A forbidden one is a thing the household does not own.
export const scoreSubjects = (
  truth: GroundTruth,
  output: SystemDocument,
  index: CorpusIndex,
): readonly Judgement[] =>
  truth.subjects.map(({ subject, requirement }) => {
    const definition = index.subject(subject);
    const present = output.subjects.some(
      ({ kind, label }) => kind === definition.kind && labelNamesSubject(label, definition),
    );
    return judgePresence(subject, requirement, present);
  });

export const scorePrivacy = (truth: GroundTruth, output: SystemDocument): Judgement =>
  judgePresence('private', truth.private, output.private);
