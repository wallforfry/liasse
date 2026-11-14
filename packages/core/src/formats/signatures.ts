const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const startsWith =
  (signature: readonly number[]) =>
  (bytes: Uint8Array): boolean =>
    signature.every((byte, index) => bytes[index] === byte);

export const isPdf = startsWith(PDF_SIGNATURE);
export const isJpeg = startsWith(JPEG_SIGNATURE);
export const isPng = startsWith(PNG_SIGNATURE);
export const startsWithZipSignature = startsWith(ZIP_SIGNATURE);
