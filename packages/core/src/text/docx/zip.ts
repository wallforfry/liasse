import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import { TextExtractionError } from '../errors.ts';

const inflate = promisify(inflateRaw);

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const STORED = 0;
const DEFLATED = 8;

interface CentralEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
  readonly next: number;
}

const corrupt = (reason: string, cause?: unknown): TextExtractionError =>
  new TextExtractionError('docx_corrupt', `The DOCX archive is not valid: ${reason}`, { cause });

const tooLarge = (name: string, maxBytes: number, cause?: unknown): TextExtractionError =>
  new TextExtractionError(
    'docx_too_large',
    `${name} expands to more than the limit of ${String(maxBytes)} bytes`,
    { cause },
  );

const findEndRecord = (view: DataView): number => {
  const lowest = Math.max(0, view.byteLength - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = view.byteLength - END_RECORD_BYTES; offset >= lowest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw corrupt('no end of central directory');
};

const readCentralEntry = (bytes: Uint8Array, view: DataView, offset: number): CentralEntry => {
  if (view.getUint32(offset, true) !== CENTRAL_ENTRY) throw corrupt('bad central directory entry');
  const nameLength = view.getUint16(offset + 28, true);
  const nameStart = offset + CENTRAL_HEADER_BYTES;
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

const findEntry = (bytes: Uint8Array, view: DataView, name: string): CentralEntry | undefined => {
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
  if (view.getUint32(header, true) !== LOCAL_ENTRY) throw corrupt('bad local file header');
  const start =
    header +
    LOCAL_HEADER_BYTES +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true);
  if (start + entry.compressedSize > bytes.length) throw corrupt('truncated file data');
  return bytes.subarray(start, start + entry.compressedSize);
};

const expand = async (data: Uint8Array, entry: CentralEntry, maxBytes: number) => {
  if (entry.method === STORED) return data;
  if (entry.method !== DEFLATED) throw corrupt('unsupported compression method');
  try {
    // The size an archive declares is only a claim, so it is not read: inflating stops at
    // the cap, before a decompression bomb is expanded in memory.
    return Uint8Array.from(await inflate(data, { maxOutputLength: maxBytes }));
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge(entry.name, maxBytes, error);
    throw corrupt('invalid compressed data', error);
  }
};

// Reads one file of a ZIP archive without expanding the others. Returns `undefined` when
// the archive has no such file.
export const readZipEntry = async (
  bytes: Uint8Array,
  name: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const entry = findEntry(bytes, view, name);
    if (entry === undefined) return undefined;
    const expanded = await expand(compressedData(bytes, view, entry), entry, maxBytes);
    if (expanded.length > maxBytes) throw tooLarge(name, maxBytes);
    return expanded;
  } catch (error) {
    // A `DataView` read past the end of a truncated archive throws a RangeError.
    if (error instanceof RangeError) throw corrupt('truncated archive', error);
    throw error;
  }
};
