import { IN_PROGRESS_STATUSES } from '@liasse/contract/domain';
import type { DocumentSummary } from '@liasse/sdk';

const IN_PROGRESS: ReadonlySet<string> = new Set(IN_PROGRESS_STATUSES);

export const POLL_MILLISECONDS = 2000;

/** How often to read documents again: while one is processed, until they all settle. */
export const pollWhileProcessing = (
  documents: readonly Pick<DocumentSummary, 'status'>[] | undefined,
): number | false =>
  documents?.some(({ status }) => IN_PROGRESS.has(status)) === true ? POLL_MILLISECONDS : false;

/** Neither on its way through the pipeline nor failed: indexed, or waiting for a review. */
export const isSettled = ({ status }: Pick<DocumentSummary, 'status'>): boolean =>
  !IN_PROGRESS.has(status) && status !== 'failed';
