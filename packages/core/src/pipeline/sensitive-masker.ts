import type { MaskSensitive } from './deps.ts';

export interface SensitiveSpan {
  /** Offsets in the text searched, `end` excluded. */
  readonly start: number;
  readonly end: number;
}

/**
 * Builds the `maskSensitive` of the pipeline from a detector and a masker: every span
 * the detector finds is replaced by what the masker makes of it. Bound once to
 * `findSensitiveIdentifiers` and `maskSensitiveIdentifier` of `@liasse/core/entities`.
 */
export const createSensitiveMasker =
  <Match extends SensitiveSpan>(
    find: (text: string) => readonly Match[],
    mask: (match: Match) => string,
  ): MaskSensitive =>
  (text) => {
    // From the end, so the offsets of the spans still to replace stay true.
    const spans = find(text).toSorted((left, right) => right.start - left.start);
    return spans.reduce(
      (masked, span) => masked.slice(0, span.start) + mask(span) + masked.slice(span.end),
      text,
    );
  };
