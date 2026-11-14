import type { ExtractedText, ExtractTextInput } from '../../text/types.ts';
import {
  type ExtractInChildDeps,
  EXTRACTION_CHILD_ENTRY,
  extractWithProcess,
} from './child-session.ts';

export type { ExtractInChildDeps } from './child-session.ts';
export {
  DEFAULT_TEXT_PROCESS_LIMITS,
  TEXT_PROCESS_ERROR_CODES,
  TextProcessError,
  type TextProcessErrorCode,
  type TextProcessLimits,
} from './limits.ts';

// `extractText`, out of the server's process: pdfjs has no size cap and runs on the
// thread that calls it, so a small hostile file can take the memory and the event loop
// of whoever reads it. Here it takes those of a child that is ended at a limit.
//
// It rejects as `extractText` does (a `TextExtractionError` keeps its code, a failed
// vision call is the original error), and with a `TextProcessError` when the child is
// ended at a limit or ends by itself.
export const extractTextInChild = (
  input: ExtractTextInput,
  deps: ExtractInChildDeps,
): Promise<ExtractedText> => extractWithProcess({ entry: EXTRACTION_CHILD_ENTRY }, input, deps);
