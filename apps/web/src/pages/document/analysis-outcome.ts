import type { DocumentEvent } from '@liasse/sdk';

export type AnalysisOutcome =
  | { readonly kind: 'done'; readonly type: string | null }
  | { readonly kind: 'failed'; readonly errorCode: string | null }
  /** The jobs wrote nothing: the document changed, or went, before they ran. */
  | { readonly kind: 'unchanged' };

const WRITING_STAGES: ReadonlySet<DocumentEvent['stage']> = new Set([
  'classification',
  'extraction',
  'reextraction',
]);

/**
 * How an analysis ended, from the events logged since it was first seen pending and the
 * type the document has now. An attempt that will run again is not an end.
 */
export const analysisOutcomeOf = (
  seen: ReadonlySet<string>,
  events: readonly DocumentEvent[],
  type: string | null,
): AnalysisOutcome => {
  const fresh = events.filter(
    ({ id, stage, outcome }) =>
      !seen.has(id) && WRITING_STAGES.has(stage) && outcome !== 'retrying',
  );
  const failed = fresh.findLast(({ outcome }) => outcome === 'failed');
  if (failed !== undefined) return { kind: 'failed', errorCode: failed.error_code };
  return fresh.length === 0 ? { kind: 'unchanged' } : { kind: 'done', type };
};
