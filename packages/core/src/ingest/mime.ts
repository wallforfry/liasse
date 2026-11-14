import { SUPPORTED_MIMES, type SupportedMime } from '../domain/enums.ts';
import { isDocx } from '../formats/docx.ts';
import { checkEmail } from '../formats/email.ts';
import { isHeic } from '../formats/heic.ts';
import { isJpeg, isPdf, isPng } from '../formats/signatures.ts';

// One detector per type of `SUPPORTED_MIMES`, the list text extraction reads too: a
// type added there does not compile until ingestion knows how to recognise it. Each is
// the predicate text extraction gates the same type on, so ingestion accepts no file
// that extraction refuses for its format.
const DETECTORS: Readonly<Record<SupportedMime, (bytes: Uint8Array) => boolean>> = {
  'application/pdf': isPdf,
  'image/jpeg': isJpeg,
  'image/png': isPng,
  'image/heic': isHeic,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isDocx,
  'message/rfc822': (bytes) => checkEmail(bytes).email,
};

/**
 * The format of a file according to its content; its name plays no part. Types are
 * tried in the order of `SUPPORTED_MIMES`, where the email heuristic comes last.
 */
export const detectMimeType = (bytes: Uint8Array): SupportedMime | undefined =>
  SUPPORTED_MIMES.find((mime) => DETECTORS[mime](bytes));
