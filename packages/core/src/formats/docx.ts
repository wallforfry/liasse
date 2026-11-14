import { startsWithZipSignature } from './signatures.ts';
import { locateZipEntry, ZipFormatError } from './zip.ts';

export const DOCX_MAIN_DOCUMENT = 'word/document.xml';
const DOCX_ENTRIES = ['[Content_Types].xml', DOCX_MAIN_DOCUMENT];

const isLocatable = (bytes: Uint8Array, name: string): boolean => {
  try {
    return locateZipEntry(bytes, name) !== undefined;
  } catch (error) {
    if (error instanceof ZipFormatError) return false;
    throw error;
  }
};

/**
 * A DOCX is a ZIP archive whose content types and main document can both be located
 * the way a reader locates them before expanding them. Listing the names of the central
 * directory is not enough: an entry that points nowhere would be accepted and never read.
 */
export const isDocx = (bytes: Uint8Array): boolean =>
  startsWithZipSignature(bytes) && DOCX_ENTRIES.every((name) => isLocatable(bytes, name));
