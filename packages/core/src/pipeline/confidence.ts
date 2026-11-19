import type { ClassificationOutcome, DocumentStatus, ReviewReason } from '@liasse/contract/domain';
import type { TypeProvenance } from '../domain/provenance.ts';

// A type a person chose is certain; a document that reached extraction without any
// record of how it got its type has nothing to vouch for it.
export const typeConfidence = (type: TypeProvenance | undefined): number => {
  if (type === undefined) return 0;
  return 'manual' in type ? 1 : type.confidence;
};

/** A list value weighs by the mean of its items; null for no item. */
export const meanConfidence = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Spec: the minimum of the classification confidence and the mean confidence of the
 * filled core fields. A core value the model returned and that was dropped (no
 * verifiable quote, refused by the registry) counts as filled with a confidence of 0:
 * the model was wrong about it, which says something about the rest. A document with
 * no core value at all has a confidence of 0: nothing that can be checked was read in
 * it, so nothing supports filing it without a look.
 */
export const documentConfidence = (
  classification: number,
  coreConfidences: readonly number[],
): number => {
  const mean = meanConfidence(coreConfidences);
  return mean === null ? 0 : Math.min(classification, mean);
};

/** The reasons of `REVIEW_REASONS` that come from the confidence and the type. */
export type SettlementReason = Extract<
  ReviewReason,
  'low_confidence' | 'type_pending_extraction' | 'type_fallback' | 'type_untyped'
>;

const TYPE_OUTCOME_REASONS: Readonly<Partial<Record<ClassificationOutcome, SettlementReason>>> = {
  fallback: 'type_fallback',
  untyped: 'type_untyped',
};

/** The reason the type alone flags a document: it got the closest type, or none. */
export const typeReason = (type: TypeProvenance | undefined): SettlementReason | undefined =>
  type === undefined || 'manual' in type ? undefined : TYPE_OUTCOME_REASONS[type.outcome];

/**
 * Spec: below the threshold a document is flagged for review, and so is one that got
 * the closest type, or none, because a new type was refused. A confidence that is null is
 * owed by the extraction of a type chosen by hand.
 */
export const settlementReasons = (
  confidence: number | null,
  type: TypeProvenance | undefined,
  threshold: number,
): readonly SettlementReason[] => {
  const ofType = typeReason(type);
  return [
    ...(confidence === null ? ['type_pending_extraction' as const] : []),
    ...(confidence !== null && confidence < threshold ? ['low_confidence' as const] : []),
    ...(ofType === undefined ? [] : [ofType]),
  ];
};

/** Either way the document is indexed and can be queried. */
export const settledStatus = (
  confidence: number | null,
  type: TypeProvenance | undefined,
  threshold: number,
): Extract<DocumentStatus, 'indexed' | 'needs_review'> =>
  settlementReasons(confidence, type, threshold).length > 0 ? 'needs_review' : 'indexed';
