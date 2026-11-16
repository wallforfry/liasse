import type { DocumentCorrection, DocumentReview, DocumentView, ReviewedValue } from '@liasse/sdk';
import { plural } from '../../lib/format.ts';
import type { CorrectionReading } from './correction.ts';

/** What the person decided of a doubtful value: as it is, cleared, or another value. */
export type ValueDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'edit'; readonly text: string };

export interface ReviewDraft {
  /** The slug of the type, the current one unless the person changed it. */
  readonly type: string;
  /** By `valueKey`. A value without a decision is accepted. */
  readonly decisions: Readonly<Record<string, ValueDecision>>;
}

export const ACCEPT: ValueDecision = { kind: 'accept' };

export const valueKey = ({ section, name }: ReviewedValue): string => `${section}.${name}`;

/** The values the person is asked about: the doubtful ones a correction can confirm. */
export const reviewedValues = (review: DocumentReview): readonly ReviewedValue[] =>
  review.values.filter(({ doubtful, confirmable }) => doubtful && confirmable);

export const otherValues = (review: DocumentReview): readonly ReviewedValue[] =>
  review.values.filter((value) => !reviewedValues(review).includes(value));

export const valueOf = (document: DocumentView, { section, name }: ReviewedValue): unknown =>
  (section === 'core' ? document.core : (document.fields ?? {}))[name];

/** The text an edit starts from: a string as it is, anything else as JSON. */
export const editTextOf = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export const draftOfReview = (document: DocumentView): ReviewDraft => ({
  type: document.type ?? '',
  decisions: {},
});

export const percent = (confidence: number): string => `${String(Math.round(confidence * 100))}%`;

/** Why the document is flagged, one sentence per reason. */
export const reasonSentences = (
  document: DocumentView,
  review: DocumentReview,
): readonly string[] =>
  review.reasons.map((reason) => {
    switch (reason) {
      case 'low_confidence':
        return `Its confidence, ${percent(document.confidence ?? 0)}, is below the threshold of ${percent(review.threshold)}.`;
      case 'type_pending_extraction':
        return 'Its type was changed by hand, and its values are not extracted for that type yet.';
      case 'type_fallback':
        return 'No type fitted and no new one could be created: it got the closest type.';
      case 'type_untyped':
        return 'No type could be given to it.';
      case 'reextraction_failed':
        return 'Its last re-extraction failed: its values are the ones read before.';
      case 'rejected_values':
        return `${plural(review.rejected_values, 'value')} the model read could not be checked against the text and ${review.rejected_values === 1 ? 'was' : 'were'} left out.`;
    }
  });

type Edited = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

// An edit of a text value is the text itself; of any other value, JSON.
const readEdit = (text: string, current: unknown): Edited => {
  if (typeof current === 'string')
    return text.trim() === '' ? { ok: false } : { ok: true, value: text };
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
};

interface Outcome {
  readonly confirm: readonly string[];
  readonly core: Readonly<Record<string, unknown>>;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly problems: readonly string[];
}

const EMPTY: Outcome = { confirm: [], core: {}, fields: {}, problems: [] };

const decide = (
  outcome: Outcome,
  value: ReviewedValue,
  decision: ValueDecision,
  current: unknown,
): Outcome => {
  if (decision.kind === 'accept') return { ...outcome, confirm: [...outcome.confirm, value.name] };
  const edited: Edited =
    decision.kind === 'reject' ? { ok: true, value: null } : readEdit(decision.text, current);
  if (!edited.ok) {
    const problem =
      typeof current === 'string'
        ? `Give "${value.name}" a new value, or reject it.`
        : `The new value of "${value.name}" is not valid JSON.`;
    return { ...outcome, problems: [...outcome.problems, problem] };
  }
  return value.section === 'core'
    ? { ...outcome, core: { ...outcome.core, [value.name]: edited.value } }
    : { ...outcome, fields: { ...outcome.fields, [value.name]: edited.value } };
};

/**
 * The one correction a review sends: the type always, so the review clears the flag even
 * when every value is accepted; the accepted values confirmed, never sent back, so a
 * masked identifier keeps its real value; the rejected ones cleared, the edited ones set.
 */
export const readReview = (
  draft: ReviewDraft,
  document: DocumentView,
  review: DocumentReview,
): CorrectionReading => {
  const type = draft.type.trim();
  if (type === '') return { ok: false, problem: 'Choose a type for the document.' };
  const outcome = reviewedValues(review).reduce(
    (current, value) =>
      decide(current, value, draft.decisions[valueKey(value)] ?? ACCEPT, valueOf(document, value)),
    EMPTY,
  );
  const [problem] = outcome.problems;
  if (problem !== undefined) return { ok: false, problem };
  const correction: DocumentCorrection = {
    type,
    ...(outcome.confirm.length === 0 ? {} : { confirm: [...outcome.confirm] }),
    ...(Object.keys(outcome.core).length === 0 ? {} : { core: outcome.core }),
    ...(Object.keys(outcome.fields).length === 0 ? {} : { fields: outcome.fields }),
  };
  return { ok: true, correction };
};
