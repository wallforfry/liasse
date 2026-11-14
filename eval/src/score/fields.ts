import type {
  CoreFieldName,
  CoreTruth,
  GroundTruth,
  SystemDocument,
  TruthPrimitive,
  TypeFieldTruth,
} from '../schema/index.ts';
import { COMPARISONS, isMasked, nameMatches } from './compare.ts';
import type { CorpusIndex } from './corpus-index.ts';
import { type Judgement, judgeValue } from './outcome.ts';

// Each field of the common core compares as the primitive it is in the registry, except
// the issuer and the recipient: the truth holds the key of an entity, the system a name.
const judgeCoreField = {
  document_date: (truth, core, index) =>
    judgeValue('document_date', truth.document_date, core.document_date, (expected, actual) =>
      COMPARISONS.date(expected, actual, index),
    ),
  issuer: (truth, core, index) =>
    judgeValue(
      'issuer',
      truth.issuer,
      core.issuer,
      (key, actual) => typeof actual === 'string' && nameMatches(actual, index.entityNames(key)),
    ),
  recipient: (truth, core, index) =>
    judgeValue(
      'recipient',
      truth.recipient,
      core.recipient,
      (key, actual) => typeof actual === 'string' && nameMatches(actual, index.entityNames(key)),
    ),
  amount: (truth, core, index) =>
    judgeValue('amount', truth.amount, core.amount, (expected, actual) =>
      COMPARISONS.money(expected, actual, index),
    ),
  period: (truth, core, index) =>
    judgeValue('period', truth.period, core.period, (expected, actual) =>
      COMPARISONS.period(expected, actual, index),
    ),
  due_date: (truth, core, index) =>
    judgeValue('due_date', truth.due_date, core.due_date, (expected, actual) =>
      COMPARISONS.date(expected, actual, index),
    ),
  reference: (truth, core, index) =>
    judgeValue('reference', truth.reference, core.reference, (expected, actual) =>
      COMPARISONS.identifier(expected, actual, index),
    ),
  language: (truth, core) =>
    judgeValue(
      'language',
      truth.language,
      core.language,
      (expected, actual) => expected === actual,
    ),
} as const satisfies Readonly<
  Record<
    CoreFieldName,
    (truth: CoreTruth, core: SystemDocument['core'], index: CorpusIndex) => Judgement
  >
>;

export const scoreCore = (
  truth: CoreTruth,
  core: SystemDocument['core'],
  index: CorpusIndex,
): readonly Judgement[] => Object.values(judgeCoreField).map((judge) => judge(truth, core, index));

interface Stored {
  readonly name: string;
  readonly value: unknown;
}

// Type fields first: a value promoted to the schema wins over the same name in `extra`.
const storedValues = ({ fields, extra }: SystemDocument): readonly Stored[] =>
  [...Object.entries(fields), ...Object.entries(extra)].map(([name, value]) => ({ name, value }));

const matcherOf =
  (field: TypeFieldTruth, truth: GroundTruth, index: CorpusIndex) =>
  (expected: unknown, actual: unknown): boolean => {
    if (!field.masked) return COMPARISONS[field.primitive](expected, actual, index);
    const clear = truth.masking.find(({ visible_tail }) => visible_tail === expected)?.clear;
    return (
      typeof expected === 'string' &&
      typeof actual === 'string' &&
      clear !== undefined &&
      isMasked(actual, expected, clear)
    );
  };

// The primitives whose values identify themselves: an amount with its currency, an
// identifier, a date. A number, a flag or a word found under an unrelated name proves
// nothing: `copies: 2` is not a notice period of two months.
const SELF_IDENTIFYING: readonly TruthPrimitive[] = ['money', 'identifier', 'date'];

// Field names are emergent, so a value is looked for under the names the truth accepts.
// An amount, an identifier or a date is then looked for under any other name: found
// there, it is correct and the note says where, so that a report can tell a naming
// disagreement from a missing value.
const scoreTypeField = (
  field: TypeFieldTruth,
  truth: GroundTruth,
  output: SystemDocument,
  index: CorpusIndex,
): Judgement => {
  const [preferred = ''] = field.names;
  const stored = storedValues(output);
  const named = stored.find(({ name }) => field.names.includes(name));
  const matches = matcherOf(field, truth, index);
  const judgement = judgeValue(preferred, field.expectation, named?.value, matches);
  if (
    judgement.outcome === 'correct' ||
    field.expectation.requirement === 'forbidden' ||
    !SELF_IDENTIFYING.includes(field.primitive)
  ) {
    return judgement;
  }
  const { value } = field.expectation;
  const elsewhere = stored.find((candidate) => matches(value, candidate.value));
  return elsewhere === undefined
    ? judgement
    : { ...judgement, outcome: 'correct', note: `found as "${elsewhere.name}"` };
};

export const scoreTypeFields = (
  truth: GroundTruth,
  output: SystemDocument,
  index: CorpusIndex,
): readonly Judgement[] => truth.fields.map((field) => scoreTypeField(field, truth, output, index));
