import type { DocumentStatus } from '../domain/enums.ts';
import type { TypeProvenance } from '../domain/provenance.ts';

// A type a person chose is certain; a document that reached extraction without any
// record of how it got its type has nothing to vouch for it.
export const typeConfidence = (type: TypeProvenance | undefined): number => {
  if (type === undefined) return 0;
  return 'manual' in type ? 1 : type.confidence;
};

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
  if (coreConfidences.length === 0) return 0;
  const mean = coreConfidences.reduce((sum, value) => sum + value, 0) / coreConfidences.length;
  return Math.min(classification, mean);
};

// Spec: below the threshold a document is flagged for review, and so is one that got
// the closest type, or none, because a new type was refused or over quota.
const needsReview = (
  confidence: number | null,
  type: TypeProvenance | undefined,
  threshold: number,
): boolean =>
  confidence === null ||
  confidence < threshold ||
  (type !== undefined &&
    !('manual' in type) &&
    (type.outcome === 'fallback' || type.outcome === 'untyped'));

/** Either way the document is indexed and can be queried. */
export const settledStatus = (
  confidence: number | null,
  type: TypeProvenance | undefined,
  threshold: number,
): Extract<DocumentStatus, 'indexed' | 'needs_review'> =>
  needsReview(confidence, type, threshold) ? 'needs_review' : 'indexed';
