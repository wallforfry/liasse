import { ownValue } from '@liasse/contract/registry';

/** Values the model returned that were dropped, by field: one per item of a list. */
export type Rejections = Readonly<Record<string, number>>;

export const rejectionsOf = (counts: readonly (readonly [string, number])[]): Rejections =>
  counts.reduce<Rejections>(
    (total, [name, count]) =>
      count === 0 ? total : { ...total, [name]: (ownValue(total, name) ?? 0) + count },
    {},
  );

export const addRejections = (...all: readonly Rejections[]): Rejections =>
  rejectionsOf(all.flatMap((rejections) => Object.entries(rejections)));

export const totalRejections = (rejections: Rejections): number =>
  Object.values(rejections).reduce((total, count) => total + count, 0);

/**
 * The confidence of every value the model returned for each field: the kept ones, then
 * 0 for each one that was dropped.
 */
export const confidencesWithRejections = (
  kept: Readonly<Record<string, readonly number[]>>,
  rejections: Rejections,
): Readonly<Record<string, readonly number[]>> =>
  Object.fromEntries(
    [...new Set([...Object.keys(kept), ...Object.keys(rejections)])].map((name) => [
      name,
      [
        ...(ownValue(kept, name) ?? []),
        ...Array.from({ length: ownValue(rejections, name) ?? 0 }, () => 0),
      ],
    ]),
  );
