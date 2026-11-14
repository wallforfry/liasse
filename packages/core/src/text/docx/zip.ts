import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import { locateZipEntry, type ZipEntry, ZipFormatError } from '../../formats/zip.ts';
import { TextExtractionError } from '../errors.ts';

const inflate = promisify(inflateRaw);

const corrupt = (reason: string, cause?: unknown): TextExtractionError =>
  new TextExtractionError('docx_corrupt', `The DOCX archive is not valid: ${reason}`, { cause });

const tooLarge = (name: string, maxBytes: number, cause?: unknown): TextExtractionError =>
  new TextExtractionError(
    'docx_too_large',
    `${name} expands to more than the limit of ${String(maxBytes)} bytes`,
    { cause },
  );

const locate = (bytes: Uint8Array, name: string): ZipEntry | undefined => {
  try {
    return locateZipEntry(bytes, name);
  } catch (error) {
    if (error instanceof ZipFormatError) throw corrupt(error.message, error);
    throw error;
  }
};

const expand = async ({ name, compression, data }: ZipEntry, maxBytes: number) => {
  if (compression === 'stored') return data;
  try {
    // The size an archive declares is only a claim, so it is not read: inflating stops at
    // the cap, before a decompression bomb is expanded in memory.
    return Uint8Array.from(await inflate(data, { maxOutputLength: maxBytes }));
  } catch (error) {
    if (error instanceof RangeError) throw tooLarge(name, maxBytes, error);
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
  const entry = locate(bytes, name);
  if (entry === undefined) return undefined;
  const expanded = await expand(entry, maxBytes);
  if (expanded.length > maxBytes) throw tooLarge(name, maxBytes);
  return expanded;
};
