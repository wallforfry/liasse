import { TextExtractionError } from '../errors.ts';

const SNIFFED_BYTES = 16 * 1024;
// The bytes are read as Latin-1, where the UTF-8 byte order mark is these three characters.
const PREAMBLE = /^(?:\xef\xbb\xbf)?(?:\r?\n)*/;
// A field name is printable ASCII without a colon, directly followed by a colon (RFC
// 5322, 2.2). The obsolete form with spaces before the colon (4.5) is not accepted: the
// MIME parser does not read it either, and would drop such a header without a word.
const HEADER_FIELD = /^([\x21-\x39\x3b-\x7e]+):/;
// One of these is in any message a mail system wrote or relayed. A text note or a JSON
// document can start with something shaped like a field, but carries none of them.
const MESSAGE_HEADERS = new Set([
  'from',
  'to',
  'date',
  'subject',
  'message-id',
  'received',
  'return-path',
  'mime-version',
  'content-type',
]);

const notAnEmail = (reason: string): TextExtractionError =>
  new TextExtractionError('eml_corrupt', `The file is not an email: ${reason}`);

// The MIME parser accepts any bytes and returns them as a body, so without this check a
// PDF, an image or a note declared as an email would become a page of text. A byte order
// mark and blank lines before the first header are allowed: the parser skips them too.
export const assertLooksLikeEmail = (bytes: Uint8Array): void => {
  const head = Buffer.from(bytes.subarray(0, SNIFFED_BYTES)).toString('latin1');
  const [headerBlock = ''] = head.replace(PREAMBLE, '').split(/\r?\n\r?\n/, 1);
  const names = headerBlock
    .split(/\r?\n/)
    .map((line) => HEADER_FIELD.exec(line)?.[1]?.toLowerCase());
  if (names[0] === undefined) throw notAnEmail('it does not start with a header field');
  if (!names.some((name) => name !== undefined && MESSAGE_HEADERS.has(name))) {
    throw notAnEmail('it has none of the headers of a message');
  }
};
