import { IN_PROGRESS_STATUSES } from '@liasse/contract/domain';
import type { DocumentSummary } from '@liasse/sdk';

const IN_PROGRESS: ReadonlySet<string> = new Set(IN_PROGRESS_STATUSES);

export const POLL_MILLISECONDS = 2000;

/** How often to read documents again: while one is processed, until they all settle. */
export const pollWhileProcessing = (
  documents: readonly Pick<DocumentSummary, 'status'>[] | undefined,
): number | false =>
  documents?.some(({ status }) => IN_PROGRESS.has(status)) === true ? POLL_MILLISECONDS : false;
