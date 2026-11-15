import type { DocumentStatus, ProcessingStage } from '@liasse/contract/domain';

interface Progress {
  readonly status: DocumentStatus;
  readonly confidence: number | null;
}

/**
 * The stage a document in `status` is waiting on, which is the one that failed when an
 * attempt stops there. A classified document without a confidence awaits its fields. A
 * failed or deleted document awaits nothing.
 */
export const pendingStageOf = ({ status, confidence }: Progress): ProcessingStage | undefined => {
  switch (status) {
    case 'received':
      return 'text';
    case 'extracted':
      return 'classification';
    case 'classified':
      return confidence === null ? 'extraction' : 'indexing';
    case 'indexed':
    case 'needs_review':
      return 'indexing';
    case 'failed':
    case 'deleted':
      return undefined;
  }
};
