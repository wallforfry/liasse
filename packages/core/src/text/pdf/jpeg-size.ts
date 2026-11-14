export interface JpegSize {
  readonly width: number;
  readonly height: number;
}

const MARKER = 0xff;
const START_OF_IMAGE = 0xd8;
const START_OF_SCAN = 0xda;
// Start-of-frame markers run from C0 to CF, except these three, which define tables.
const FIRST_FRAME = 0xc0;
const LAST_FRAME = 0xcf;
const NOT_FRAMES = new Set([0xc4, 0xc8, 0xcc]);

// Reads the size of a JPEG image from its frame header, without decoding it. `undefined`
// when the bytes are not a JPEG image.
export const readJpegSize = (bytes: Uint8Array): JpegSize | undefined => {
  if (bytes[0] !== MARKER || bytes[1] !== START_OF_IMAGE) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 <= bytes.length && bytes[offset] === MARKER) {
    const marker = bytes[offset + 1] ?? START_OF_SCAN;
    if (marker >= FIRST_FRAME && marker <= LAST_FRAME && !NOT_FRAMES.has(marker)) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    if (marker === START_OF_SCAN) return undefined;
    offset += 2 + view.getUint16(offset + 2);
  }
  return undefined;
};
