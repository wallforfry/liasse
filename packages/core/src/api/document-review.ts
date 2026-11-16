import type { DocumentReview, ReviewedValue } from '@liasse/contract';
import {
  DOCUMENT_JOB_FAILURE_CODES,
  type DocumentStatus,
  type ReviewReason,
  type ValueSection,
} from '@liasse/contract/domain';
import { KEY_DATES_FIELD, ownValue } from '@liasse/contract/registry';
import { z } from 'zod';
import {
  entityProvenanceSchema,
  extractedProvenanceSchema,
  manualEntityProvenanceSchema,
  manualProvenanceSchema,
  readPipelineProvenance,
  type TypeProvenance,
} from '../domain/provenance.ts';
import { meanConfidence, settlementReasons, typeReason } from '../pipeline/confidence.ts';

type Values = Readonly<Record<string, unknown>>;

/** What the review of a document is computed from: the stored row. */
export interface ReviewedDocument {
  readonly status: DocumentStatus;
  readonly confidence: number | null;
  readonly error: string | null;
  readonly core: Values;
  readonly fields: Values;
  readonly provenance: Values;
}

interface ItemRecord {
  readonly confidence: number | null;
  readonly page: number | null;
  readonly quote: string | null;
  readonly manual: boolean;
}

// An entity name carries the confidence of its resolution, and no quote.
const itemRecordSchema = z.union([
  z
    .union([manualProvenanceSchema, manualEntityProvenanceSchema])
    .transform((): ItemRecord => ({ confidence: null, page: null, quote: null, manual: true })),
  extractedProvenanceSchema.transform(({ confidence, page, quote }): ItemRecord => ({
    confidence,
    page,
    quote,
    manual: false,
  })),
  entityProvenanceSchema.transform(({ confidence }): ItemRecord => ({
    confidence,
    page: null,
    quote: null,
    manual: false,
  })),
]);

const NO_RECORD: ItemRecord = { confidence: null, page: null, quote: null, manual: false };

const itemRecord = (entry: unknown): ItemRecord =>
  itemRecordSchema.safeParse(entry).data ?? NO_RECORD;

// A list value has one provenance entry per item; it is manual when every item is. Like
// the confidence of the document, it weighs by the mean of its items, a manual one at 1.
const valueRecord = (value: unknown, entry: unknown): ItemRecord => {
  if (!Array.isArray(value)) return itemRecord(entry);
  const items = value.map((_, index) =>
    itemRecord(Array.isArray(entry) ? entry[index] : undefined),
  );
  const quoted = items.find((item) => item.quote !== null);
  const manual = items.length > 0 && items.every((item) => item.manual);
  const confidences = items.flatMap(({ confidence, manual: byHand }) =>
    byHand ? [1] : confidence === null ? [] : [confidence],
  );
  return {
    confidence: manual || confidences.length < items.length ? null : meanConfidence(confidences),
    page: quoted?.page ?? null,
    quote: quoted?.quote ?? null,
    manual,
  };
};

// Nothing vouches for a value of no known confidence either.
const belowThreshold = (confidence: number | null, threshold: number): boolean =>
  confidence === null || confidence < threshold;

const reviewedValues = (
  section: ValueSection,
  values: Values,
  provenance: Values,
  threshold: number,
): readonly ReviewedValue[] =>
  Object.entries(values).map(([name, value]) => {
    const record = valueRecord(value, ownValue(provenance, name));
    return {
      section,
      name,
      ...record,
      doubtful: !record.manual && belowThreshold(record.confidence, threshold),
      confirmable: section === 'fields' || name !== KEY_DATES_FIELD,
    };
  });

// The type is in doubt by the rule that settles a document, nothing else: the confidence
// of the classification already weighs on the confidence of the document.
const reviewedType = (type: TypeProvenance | undefined) =>
  type !== undefined && 'manual' in type
    ? { confidence: null, outcome: null, manual: true, doubtful: false }
    : {
        confidence: type?.confidence ?? null,
        outcome: type?.outcome ?? null,
        manual: false,
        doubtful: typeReason(type) !== undefined,
      };

// A document flagged by a rule or a threshold that no longer flags it, the threshold
// having been raised since, still says it was flagged.
const flagReasons = (
  document: ReviewedDocument,
  type: TypeProvenance | undefined,
  threshold: number,
): readonly ReviewReason[] => {
  const reasons: readonly ReviewReason[] = [
    ...settlementReasons(document.confidence, type, threshold),
    ...(document.error === DOCUMENT_JOB_FAILURE_CODES.reextraction
      ? ['reextraction_failed' as const]
      : []),
  ];
  return reasons.length > 0 ? reasons : ['flagged_at_settlement'];
};

/**
 * Why a document is flagged, and how sure the pipeline is of its type and its values,
 * by the rule that settles a document and the current threshold. Only a document in
 * `needs_review` has reasons: on any other, the flag is not, or no longer, raised.
 */
export const reviewDocument = (document: ReviewedDocument, threshold: number): DocumentReview => {
  const pipeline = readPipelineProvenance(document.provenance);
  const rejected = pipeline.extraction?.rejected_values ?? 0;
  const reasons: readonly ReviewReason[] =
    document.status === 'needs_review'
      ? [
          ...flagReasons(document, pipeline.type, threshold),
          ...(rejected > 0 ? ['rejected_values' as const] : []),
        ]
      : [];
  return {
    threshold,
    reasons: [...reasons],
    rejected_values: rejected,
    type: reviewedType(pipeline.type),
    values: [
      ...reviewedValues('core', document.core, document.provenance, threshold),
      ...reviewedValues('fields', document.fields, document.provenance, threshold),
    ],
  };
};
