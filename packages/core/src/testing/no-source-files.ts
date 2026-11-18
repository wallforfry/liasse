import { type SourceFiles, SourceFileUnavailableError } from '../ingest/document-file.ts';

/** For a test without sources: no file is kept at one. */
export const NO_SOURCE_FILES: SourceFiles = {
  open: () => Promise.reject(new SourceFileUnavailableError('No source holds files in this test.')),
};
