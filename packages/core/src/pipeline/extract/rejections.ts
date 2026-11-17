import type { Rejection } from '@liasse/contract';
import type { RejectionReason, RejectionSection } from '@liasse/contract/domain';
import { ownValue } from '@liasse/contract/registry';

/** One value of a section the model returned that was dropped: one per item of a list. */
export interface DroppedValue {
  readonly name: string;
  readonly reason: RejectionReason;
}

export type Rejections = readonly DroppedValue[];

export const dropped = (name: string, reason: RejectionReason, count = 1): Rejections =>
  Array.from({ length: count }, () => ({ name, reason }));

const countsByName = (rejections: Rejections): Readonly<Record<string, number>> =>
  rejections.reduce<Readonly<Record<string, number>>>(
    (counts, { name }) => ({ ...counts, [name]: (ownValue(counts, name) ?? 0) + 1 }),
    {},
  );

/**
 * The confidence of every value the model returned for each field: the kept ones, then
 * 0 for each one that was dropped.
 */
export const confidencesWithRejections = (
  kept: Readonly<Record<string, readonly number[]>>,
  rejections: Rejections,
): Readonly<Record<string, readonly number[]>> => {
  const counts = countsByName(rejections);
  return Object.fromEntries(
    [...new Set([...Object.keys(kept), ...Object.keys(counts)])].map((name) => [
      name,
      [
        ...(ownValue(kept, name) ?? []),
        ...Array.from({ length: ownValue(counts, name) ?? 0 }, () => 0),
      ],
    ]),
  );
};

/** One entry per name and reason, in the order they were first dropped. */
export const recordRejections = (
  section: RejectionSection,
  rejections: readonly { readonly name: string | null; readonly reason: RejectionReason }[],
): readonly Rejection[] =>
  rejections.reduce<readonly Rejection[]>((records, { name, reason }) => {
    const same = (record: Rejection) => record.name === name && record.reason === reason;
    return records.some(same)
      ? records.map((record) => (same(record) ? { ...record, count: record.count + 1 } : record))
      : [...records, { section, name, reason, count: 1 }];
  }, []);

/** Dropped parts of the knowledge of a document, which have no name. */
export const recordKnowledgeRejections = (
  section: RejectionSection,
  reasons: readonly RejectionReason[],
): readonly Rejection[] =>
  recordRejections(
    section,
    reasons.map((reason) => ({ name: null, reason })),
  );

export const totalRejections = (records: readonly Rejection[]): number =>
  records.reduce((total, { count }) => total + count, 0);
