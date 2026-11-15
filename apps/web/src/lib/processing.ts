import type { DocumentSummary } from '@liasse/sdk';

// The statuses of a document the pipeline is still working on.
const IN_PROGRESS: ReadonlySet<DocumentSummary['status']> = new Set([
  'received',
  'extracted',
  'classified',
]);

const POLL_MILLISECONDS = 2000;

/** How often to read a document again: while it is processed, until it settles. */
export const pollWhileProcessing = (
  documents: readonly Pick<DocumentSummary, 'status'>[] | undefined,
): number | false =>
  documents?.some(({ status }) => IN_PROGRESS.has(status)) === true ? POLL_MILLISECONDS : false;
