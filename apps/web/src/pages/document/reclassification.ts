import type { DocumentEvent } from '@liasse/sdk';

/** A reclassification asked for: the events logged before it and the type it rejected. */
export interface Reclassification {
  readonly seen: ReadonlySet<string>;
  readonly rejectedType: string | null;
}

export type ReclassificationProgress =
  | { readonly step: 'classifying' | 'extracting' }
  | { readonly step: 'done'; readonly type: string | null }
  | { readonly step: 'failed'; readonly errorCode: string | null };

export const reclassificationOf = (
  before: readonly DocumentEvent[],
  rejectedType: string | null,
): Reclassification => ({ seen: new Set(before.map(({ id }) => id)), rejectedType });

const latestOf = (
  events: readonly DocumentEvent[],
  stage: DocumentEvent['stage'],
): DocumentEvent | undefined => events.findLast((event) => event.stage === stage);

/**
 * How far a reclassification went, from the events logged since it was asked for and the
 * type the document has now. A new type moves values and starts a re-extraction, which
 * is waited for too; the same type ends it.
 */
export const progressOf = (
  { seen, rejectedType }: Reclassification,
  events: readonly DocumentEvent[],
  type: string | null,
): ReclassificationProgress => {
  const settled = events.filter(({ id, outcome }) => !seen.has(id) && outcome !== 'retrying');
  const classification = latestOf(settled, 'classification');
  if (classification === undefined) return { step: 'classifying' };
  if (classification.outcome === 'failed') {
    return { step: 'failed', errorCode: classification.error_code };
  }
  if (type === rejectedType) return { step: 'done', type };
  const reextraction = latestOf(settled, 'reextraction');
  if (reextraction === undefined) return { step: 'extracting' };
  return reextraction.outcome === 'failed'
    ? { step: 'failed', errorCode: reextraction.error_code }
    : { step: 'done', type };
};
