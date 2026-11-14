const SAMPLE_LENGTH = 64 * 1024;
const HEADER_FIELD = /^([!-9;-~]+):/;
const CONTINUATION = /^[ \t]/;
const SENDER_FIELDS = ['from', 'sender', 'return-path'];
const MESSAGE_FIELDS = ['date', 'subject', 'to', 'message-id', 'received', 'mime-version'];

const headerNames = (lines: readonly string[]): readonly string[] | undefined => {
  const names = lines.flatMap((line) => {
    const name = HEADER_FIELD.exec(line)?.[1];
    return name === undefined ? [] : [name.toLowerCase()];
  });
  const wellFormed =
    lines[0] !== undefined &&
    HEADER_FIELD.test(lines[0]) &&
    lines.every((line) => HEADER_FIELD.test(line) || CONTINUATION.test(line));
  return wellFormed ? names : undefined;
};

/**
 * An email has no magic number. A file is taken for one when it is text that opens with
 * a well-formed RFC 5322 header block naming a sender and one more usual message field.
 */
export const looksLikeEmail = (bytes: Uint8Array): boolean => {
  const sample = bytes.subarray(0, SAMPLE_LENGTH);
  if (sample.includes(0)) return false;
  const text = Buffer.from(sample.buffer, sample.byteOffset, sample.byteLength).toString('latin1');
  const headerEnd = text.search(/\r?\n\r?\n/);
  // A header block cut by the sample may end in the middle of a line.
  const block = headerEnd === -1 ? text.slice(0, text.lastIndexOf('\n')) : text.slice(0, headerEnd);
  const names = headerNames(block.split(/\r?\n/));
  return (
    names !== undefined &&
    SENDER_FIELDS.some((field) => names.includes(field)) &&
    MESSAGE_FIELDS.some((field) => names.includes(field))
  );
};
