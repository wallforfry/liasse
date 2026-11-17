import type {
  DocumentCorrection,
  DocumentReclassification,
  DocumentReview,
  DocumentView,
  ReviewedValue,
} from '@liasse/sdk';
import { plural } from '../../lib/format.ts';

/** What the person decided of a doubtful value: as it is, cleared, or another value. */
export type ValueDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'edit'; readonly text: string };

export interface ReviewDraft {
  /** The slug of the type, the current one unless the person changed it. */
  readonly type: string;
  /**
   * What the person knows about the document, when they ask the model for its type
   * again instead of choosing one; null otherwise.
   */
  readonly reanalysis: string | null;
  /** By `valueKey`. A value without a decision is accepted. */
  readonly decisions: Readonly<Record<string, ValueDecision>>;
}

export type ReviewReading =
  | { readonly ok: true; readonly correction: DocumentCorrection }
  | { readonly ok: false; readonly problem: string };

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
  reanalysis: null,
  decisions: {},
});

/** The request a review that asks for the type again sends, or null for a correction. */
export const reclassificationOf = ({
  reanalysis,
}: ReviewDraft): DocumentReclassification | null => {
  if (reanalysis === null) return null;
  const hint = reanalysis.trim();
  return hint === '' ? {} : { hint };
};

export const percent = (confidence: number): string => `${String(Math.round(confidence * 100))}%`;

export const confidenceLabel = (confidence: number | null): string =>
  confidence === null ? 'confidence unknown' : `confidence ${percent(confidence)}`;

const untypedBecause = (refusal: DocumentReview['type']['refusal']): string => {
  switch (refusal) {
    case 'quota_exceeded':
      return ': the daily quota of new types is reached, create the type by hand';
    case 'private_document':
      return ': a new type for a private document needs a local embedder';
    case 'invalid_proposal':
    case 'rejected_type':
      return ': the new type the model proposed was refused';
    case null:
      return '';
  }
};

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
        return `No type could be given to it${untypedBecause(review.type.refusal)}.`;
      case 'reextraction_failed':
        return 'Its last re-extraction failed: its values are the ones read before.';
      case 'flagged_at_settlement':
        return `It was flagged when it was processed; the threshold is ${percent(review.threshold)} now.`;
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

/**
 * A field of a document whose type the review changes is extracted again for the new
 * type: it is neither confirmed nor corrected. Core values stay.
 */
export const extractedAgain = (
  value: ReviewedValue,
  draft: ReviewDraft,
  document: DocumentView,
): boolean => value.section === 'fields' && draft.type.trim() !== (document.type ?? '');

/** Why a value is read again rather than decided in this review; null when it is decided. */
export const readAgainOf = (
  value: ReviewedValue,
  draft: ReviewDraft,
  document: DocumentView,
): string | null => {
  if (draft.reanalysis !== null) return 'Will be read again once the type is analysed.';
  return extractedAgain(value, draft, document)
    ? 'Will be extracted again for the new type.'
    : null;
};

interface Outcome {
  readonly confirm: Readonly<Record<string, unknown>>;
  readonly core: Readonly<Record<string, unknown>>;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly problems: readonly string[];
}

const EMPTY: Outcome = { confirm: {}, core: {}, fields: {}, problems: [] };

const decide = (
  outcome: Outcome,
  value: ReviewedValue,
  decision: ValueDecision,
  current: unknown,
): Outcome => {
  if (decision.kind === 'accept') {
    return { ...outcome, confirm: { ...outcome.confirm, [value.name]: current } };
  }
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
 * when every value is accepted; the accepted values confirmed with the value shown, which
 * the server refuses if it changed since and never rewrites; the rejected ones cleared,
 * the edited ones set.
 */
export const readReview = (
  draft: ReviewDraft,
  document: DocumentView,
  review: DocumentReview,
): ReviewReading => {
  const type = draft.type.trim();
  if (type === '') return { ok: false, problem: 'Choose a type for the document.' };
  const outcome = reviewedValues(review)
    .filter((value) => !extractedAgain(value, draft, document))
    .reduce(
      (current, value) =>
        decide(
          current,
          value,
          draft.decisions[valueKey(value)] ?? ACCEPT,
          valueOf(document, value),
        ),
      EMPTY,
    );
  const [problem] = outcome.problems;
  if (problem !== undefined) return { ok: false, problem };
  const correction: DocumentCorrection = {
    type,
    ...(Object.keys(outcome.confirm).length === 0 ? {} : { confirm: outcome.confirm }),
    ...(Object.keys(outcome.core).length === 0 ? {} : { core: outcome.core }),
    ...(Object.keys(outcome.fields).length === 0 ? {} : { fields: outcome.fields }),
  };
  return { ok: true, correction };
};
