import type { DocumentMimeType } from '../domain/enums.ts';
import { looksLikeEmail } from './email-heuristics.ts';
import { zipEntryNames } from './zip-entries.ts';

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const DOCX_ENTRIES = ['[Content_Types].xml', 'word/document.xml'];
const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
const BRAND_LENGTH = 4;
const FIRST_COMPATIBLE_BRAND = 16;

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

// ISO base media file: the first box is `ftyp`, holding a major brand, then a version,
// then the compatible brands. HEIC shares the container with AVIF and MP4, and a HEIC
// file may declare the generic `mif1` as its major brand.
const isHeic = (bytes: Uint8Array): boolean => {
  if (bytes.length < FIRST_COMPATIBLE_BRAND || ascii(bytes, 4, 8) !== 'ftyp') return false;
  const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), bytes.length);
  const brandOffsets = [
    8,
    ...Array.from(
      { length: Math.max(0, Math.floor((boxEnd - FIRST_COMPATIBLE_BRAND) / BRAND_LENGTH)) },
      (_, index) => FIRST_COMPATIBLE_BRAND + index * BRAND_LENGTH,
    ),
  ];
  return brandOffsets.some((offset) =>
    HEIC_BRANDS.includes(ascii(bytes, offset, offset + BRAND_LENGTH)),
  );
};

const isDocx = (bytes: Uint8Array): boolean => {
  if (!startsWith(bytes, ZIP_SIGNATURE)) return false;
  const names = zipEntryNames(bytes);
  return DOCX_ENTRIES.every((entry) => names.includes(entry));
};

const DETECTORS: readonly (readonly [DocumentMimeType, (bytes: Uint8Array) => boolean])[] = [
  ['application/pdf', (bytes) => startsWith(bytes, PDF_SIGNATURE)],
  ['image/jpeg', (bytes) => startsWith(bytes, JPEG_SIGNATURE)],
  ['image/png', (bytes) => startsWith(bytes, PNG_SIGNATURE)],
  ['image/heic', isHeic],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', isDocx],
  ['message/rfc822', looksLikeEmail],
];

/** The format of a file according to its content; its name plays no part. */
export const detectMimeType = (bytes: Uint8Array): DocumentMimeType | undefined =>
  DETECTORS.find(([, matches]) => matches(bytes))?.[0];
