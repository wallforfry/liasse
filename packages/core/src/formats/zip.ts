const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
export type ZipCompression = 'stored' | 'deflated';

const METHODS: ReadonlyMap<number, ZipCompression> = new Map([
  [0, 'stored'],
  [8, 'deflated'],
]);

export interface ZipEntry {
  readonly name: string;
  readonly compression: ZipCompression;
  /** The bytes of the file as the archive holds them, still compressed. */
  readonly data: Uint8Array;
}

/** The archive is malformed, for the reason given as the message. */
export class ZipFormatError extends Error {
  override readonly name = 'ZipFormatError';
}

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
  readonly next: number;
}

const findEndRecord = (view: DataView): number => {
  const lowest = Math.max(0, view.byteLength - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = view.byteLength - END_RECORD_BYTES; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new ZipFormatError('no end of central directory');
};

const readCentralEntry = (bytes: Uint8Array, view: DataView, offset: number): CentralEntry => {
  if (view.getUint32(offset, true) !== CENTRAL_ENTRY) {
    throw new ZipFormatError('bad central directory entry');
  }
  const nameLength = view.getUint16(offset + 28, true);
  const nameStart = offset + CENTRAL_HEADER_BYTES;
  if (nameStart + nameLength > bytes.length) throw new ZipFormatError('truncated archive');
  return {
    name: new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength)),
    method: view.getUint16(offset + 10, true),
    compressedSize: view.getUint32(offset + 20, true),
    localOffset: view.getUint32(offset + 42, true),
    next:
      nameStart +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true),
  };
};

const findCentralEntry = (
  bytes: Uint8Array,
  view: DataView,
  name: string,
): CentralEntry | undefined => {
  const endRecord = findEndRecord(view);
  const entryCount = view.getUint16(endRecord + 10, true);
  let offset = view.getUint32(endRecord + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    const entry = readCentralEntry(bytes, view, offset);
    if (entry.name === name) return entry;
    offset = entry.next;
  }
  return undefined;
};

const compressedData = (bytes: Uint8Array, view: DataView, entry: CentralEntry): Uint8Array => {
  const header = entry.localOffset;
  if (view.getUint32(header, true) !== LOCAL_ENTRY) {
    throw new ZipFormatError('bad local file header');
  }
  const start =
    header +
    LOCAL_HEADER_BYTES +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true);
  if (start + entry.compressedSize > bytes.length) throw new ZipFormatError('truncated file data');
  return bytes.subarray(start, start + entry.compressedSize);
};

const locate = (bytes: Uint8Array, view: DataView, name: string): ZipEntry | undefined => {
  const entry = findCentralEntry(bytes, view, name);
  if (entry === undefined) return undefined;
  const data = compressedData(bytes, view, entry);
  const compression = METHODS.get(entry.method);
  if (compression === undefined) throw new ZipFormatError('unsupported compression method');
  return { name, compression, data };
};

/**
 * Locates one file of a ZIP archive: its central directory entry, then its local file
 * header and its bytes, without inflating anything. Returns `undefined` when the
 * directory lists no such file before its end, and throws a `ZipFormatError` when the
 * archive is malformed on the way to the file or stores it with a method other than
 * `stored` and `deflated`. The single reader of the container: what it locates is what
 * a reader can expand.
 */
export const locateZipEntry = (bytes: Uint8Array, name: string): ZipEntry | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    return locate(bytes, view, name);
  } catch (error) {
    // A `DataView` read past the end of a truncated archive throws a RangeError.
    if (error instanceof RangeError)
      throw new ZipFormatError('truncated archive', { cause: error });
    throw error;
  }
};
