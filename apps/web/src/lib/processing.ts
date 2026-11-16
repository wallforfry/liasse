import { IN_PROGRESS_STATUSES, SETTLED_STATUSES } from '@liasse/contract/domain';
import type { DocumentSummary, DocumentView } from '@liasse/sdk';

const IN_PROGRESS: ReadonlySet<string> = new Set(IN_PROGRESS_STATUSES);

export const POLL_MILLISECONDS = 2000;

/** How often to read documents again: while one is processed, until they all settle. */
export const pollWhileProcessing = (
  documents: readonly Pick<DocumentSummary, 'status'>[] | undefined,
): number | false =>
  documents?.some(({ status }) => IN_PROGRESS.has(status)) === true ? POLL_MILLISECONDS : false;

/**
 * How often to read one document again: while it is processed, and while a job is about
 * to rewrite its type or values, which leaves its status as it is.
 */
export const pollDocument = (
  document: Pick<DocumentView, 'status' | 'analysis_pending'> | undefined,
): number | false =>
  document?.analysis_pending === true
    ? POLL_MILLISECONDS
    : pollWhileProcessing(document === undefined ? undefined : [document]);

/**
 * Indexed, or waiting for a review, with a job about to rewrite its type or values: an
 * analysis asked for again, not the first processing of the document.
 */
export const isAnalysedAgain = ({
  status,
  analysis_pending: pending,
}: Pick<DocumentView, 'status' | 'analysis_pending'>): boolean =>
  pending && SETTLED_STATUSES.includes(status);
