import type { DocumentEvent, DocumentView } from '@liasse/sdk';
import { isSettled } from '../../lib/processing.ts';

/** A reclassification asked for: the events logged before it and the type it rejected. */
export interface Reclassification {
  readonly seen: ReadonlySet<string>;
  readonly rejectedType: string | null;
}

export type ReclassificationProgress =
  | { readonly step: 'classifying' | 'extracting' }
  /** The job wrote nothing: the document went, or changed, before it ran. */
  | { readonly step: 'abandoned' }
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

/** What the document is now; undefined once it is gone. */
export type CurrentDocument = Pick<DocumentView, 'type' | 'status'> | undefined;

/**
 * How far a reclassification went, from the events logged since it was asked for and the
 * document as it is now, read before the events. A new type moves values and starts a
 * re-extraction, which is waited for too; the same type ends it. The job logs its event
 * with the type it writes, so a document gone, no longer settled, or of another type
 * without that event is one the job left alone.
 */
export const progressOf = (
  { seen, rejectedType }: Reclassification,
  events: readonly DocumentEvent[],
  document: CurrentDocument,
): ReclassificationProgress => {
  const settled = events.filter(({ id, outcome }) => !seen.has(id) && outcome !== 'retrying');
  const classification = latestOf(settled, 'classification');
  if (classification === undefined) {
    return document === undefined || !isSettled(document) || document.type !== rejectedType
      ? { step: 'abandoned' }
      : { step: 'classifying' };
  }
  if (document === undefined) return { step: 'abandoned' };
  const { type } = document;
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
