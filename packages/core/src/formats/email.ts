export const EMAIL_SAMPLE_BYTES = 64 * 1024;
// A field name is printable ASCII without a colon, directly followed by a colon (RFC
// 5322, 2.2). The obsolete form with spaces before the colon (4.5) is not accepted: the
// MIME parser does not read it either, and would drop such a header without a word.
const HEADER_FIELD = /^([!-9;-~]+):/;
const CONTINUATION = /^[ \t]/;
const SENDER_FIELDS = ['from', 'sender', 'return-path'];
const MESSAGE_FIELDS = ['date', 'subject', 'to', 'message-id', 'received', 'mime-version'];

export type EmailCheck =
  { readonly email: true } | { readonly email: false; readonly reason: string };

const refused = (reason: string): EmailCheck => ({ email: false, reason });

const headerLines = (bytes: Uint8Array, sample: Uint8Array): readonly string[] => {
  const text = Buffer.from(sample.buffer, sample.byteOffset, sample.byteLength).toString('latin1');
  const headerEnd = text.search(/\r?\n\r?\n/);
  if (headerEnd !== -1) return text.slice(0, headerEnd).split(/\r?\n/);
  // A header block cut by the sample may end in the middle of a line.
  const wholeLines =
    bytes.length > sample.length ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  return wholeLines.replace(/\r?\n$/, '').split(/\r?\n/);
};

/**
 * An email has no magic number. A file is one when it is text that opens with a
 * well-formed RFC 5322 header block naming a sender and one more usual message field,
 * all within the sample. Nothing may precede the first field, neither a byte order mark
 * nor a blank line: the MIME parser (postal-mime) reads the headers of such a file as
 * its body. Ingestion and text extraction both decide with this function, so a file
 * accepted by one is never refused by the other.
 */
export const checkEmail = (bytes: Uint8Array): EmailCheck => {
  const sample = bytes.subarray(0, EMAIL_SAMPLE_BYTES);
  const lines = headerLines(bytes, sample);
  if (lines[0] === undefined || !HEADER_FIELD.test(lines[0])) {
    return refused('it does not start with a header field');
  }
  if (!lines.every((line) => HEADER_FIELD.test(line) || CONTINUATION.test(line))) {
    return refused('its header block holds a line that is not a header field');
  }
  if (sample.includes(0)) return refused('it holds a NUL byte');
  const names = lines.flatMap((line) => {
    const name = HEADER_FIELD.exec(line)?.[1];
    return name === undefined ? [] : [name.toLowerCase()];
  });
  if (!SENDER_FIELDS.some((field) => names.includes(field))) {
    return refused('it names no sender');
  }
  if (!MESSAGE_FIELDS.some((field) => names.includes(field))) {
    return refused('it has no other field of a message');
  }
  return { email: true };
};
