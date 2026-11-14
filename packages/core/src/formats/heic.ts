const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'];
const BRAND_LENGTH = 4;
const MAJOR_BRAND = 8;
const FIRST_COMPATIBLE_BRAND = 16;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

// ISO base media file: the first box is `ftyp`, holding a major brand, then a version,
// then the compatible brands. HEIC shares the container with AVIF and MP4, and a HEIC
// file may declare the generic `mif1` as its major brand.
export const isHeic = (bytes: Uint8Array): boolean => {
  if (bytes.length < FIRST_COMPATIBLE_BRAND || ascii(bytes, 4, MAJOR_BRAND) !== 'ftyp') {
    return false;
  }
  const boxEnd = Math.min(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0), bytes.length);
  const brandOffsets = [
    MAJOR_BRAND,
    ...Array.from(
      { length: Math.max(0, Math.floor((boxEnd - FIRST_COMPATIBLE_BRAND) / BRAND_LENGTH)) },
      (_, index) => FIRST_COMPATIBLE_BRAND + index * BRAND_LENGTH,
    ),
  ];
  return brandOffsets.some((offset) =>
    HEIC_BRANDS.includes(ascii(bytes, offset, offset + BRAND_LENGTH)),
  );
};
