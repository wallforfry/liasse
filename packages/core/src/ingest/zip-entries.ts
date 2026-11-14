const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_RECORD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const FILE_HEADER_LENGTH = 46;

const findEndRecord = (view: Buffer): number | undefined => {
  const lowest = Math.max(0, view.length - END_RECORD_LENGTH - MAX_COMMENT_LENGTH);
  for (let offset = view.length - END_RECORD_LENGTH; offset >= lowest; offset -= 1) {
    if (view.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return undefined;
};

/**
 * The entry names of a ZIP archive, read from its central directory without inflating
 * anything. A truncated or malformed archive yields the entries read so far.
 */
export const zipEntryNames = (bytes: Uint8Array): readonly string[] => {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endRecord = findEndRecord(view);
  if (endRecord === undefined) return [];
  const entryCount = view.readUInt16LE(endRecord + 10);
  const names: string[] = [];
  let offset = view.readUInt32LE(endRecord + 16);
  while (
    names.length < entryCount &&
    offset + FILE_HEADER_LENGTH <= view.length &&
    view.readUInt32LE(offset) === CENTRAL_FILE_HEADER
  ) {
    const nameLength = view.readUInt16LE(offset + 28);
    const nameStart = offset + FILE_HEADER_LENGTH;
    if (nameStart + nameLength > view.length) break;
    names.push(view.toString('utf8', nameStart, nameStart + nameLength));
    offset =
      nameStart + nameLength + view.readUInt16LE(offset + 30) + view.readUInt16LE(offset + 32);
  }
  return names;
};
