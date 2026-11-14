import { MAX_FILENAME_LENGTH, MAX_HINT_LENGTH } from '../domain/limits.ts';

// Postgres stores neither a NUL character nor an unpaired surrogate, and cutting a
// string by UTF-16 units can leave half a pair behind.
const UNSTORABLE = /[\0\p{Surrogate}]/gu;
const CONTROL = /\p{Cc}/gu;
const FALLBACK_FILENAME = 'unnamed';

const storable = (text: string, maxLength: number): string =>
  text.slice(0, maxLength).replace(UNSTORABLE, '');

/** The last path segment of a client-supplied name, without control characters. */
export const cleanFilename = (filename: string): string => {
  const lastSegment = filename.slice(
    Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\')) + 1,
  );
  const cleaned = storable(lastSegment.replace(CONTROL, ''), MAX_FILENAME_LENGTH).trim();
  return cleaned === '' ? FALLBACK_FILENAME : cleaned;
};

/** A caller's hint is free text for the pipeline: it is cut to size, never interpreted. */
export const cleanHint = (hint: string | undefined): string | undefined => {
  const cleaned = hint === undefined ? '' : storable(hint, MAX_HINT_LENGTH).trim();
  return cleaned === '' ? undefined : cleaned;
};
