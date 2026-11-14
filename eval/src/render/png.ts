import { crc32 } from 'node:zlib';
import type { GrayImage } from './raster.ts';

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// One bit per pixel, greyscale, no interlacing.
const BILEVEL_HEADER = [1, 0, 0, 0, 0];
const WHITE_FROM = 128;
const MAX_STORED_BLOCK = 0xffff;
const ADLER_MODULUS = 65521;
// A zlib header for a 32 KiB window and no preset dictionary, at the fastest level.
const ZLIB_HEADER = [0x78, 0x01];

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([uint32(data.length), typed, uint32(crc32(typed))]);
};

const adler32 = (data: Uint8Array): number => {
  const [low, high] = data.reduce<readonly [number, number]>(
    ([a, b], byte) => {
      const next = (a + byte) % ADLER_MODULUS;
      return [next, (b + next) % ADLER_MODULUS];
    },
    [1, 0],
  );
  return ((high << 16) | low) >>> 0;
};

// A zlib stream made of stored blocks only. Deflating would give a smaller file, but the
// bytes zlib produces depend on its version and on the processor; these never change.
const storedZlib = (data: Uint8Array): Uint8Array => {
  const blocks = Array.from({ length: Math.ceil(data.length / MAX_STORED_BLOCK) }, (_, index) => {
    const block = data.subarray(index * MAX_STORED_BLOCK, (index + 1) * MAX_STORED_BLOCK);
    const isLast = (index + 1) * MAX_STORED_BLOCK >= data.length;
    const header = new Uint8Array(5);
    const view = new DataView(header.buffer);
    view.setUint8(0, isLast ? 1 : 0);
    view.setUint16(1, block.length, true);
    view.setUint16(3, ~block.length & 0xffff, true);
    return Buffer.concat([header, block]);
  });
  return Buffer.concat([Uint8Array.from(ZLIB_HEADER), ...blocks, uint32(adler32(data))]);
};

// Each scanline is a filter byte (none) and its pixels, eight to a byte, white as 1.
const bilevelScanlines = ({ width, height, data }: GrayImage): Uint8Array => {
  const stride = 1 + Math.ceil(width / 8);
  const scanlines = new Uint8Array(stride * height);
  data.forEach((tone, index) => {
    if (tone < WHITE_FROM) return;
    const x = index % width;
    const offset = Math.floor(index / width) * stride + 1 + (x >> 3);
    scanlines[offset] = (scanlines[offset] ?? 0) | (0x80 >> (x & 7));
  });
  return scanlines;
};

// A black and white PNG, as a screenshot of a ticket or a fax would be.
export const encodeBilevelPng = (image: GrayImage): Uint8Array =>
  Uint8Array.from(
    Buffer.concat([
      PNG_SIGNATURE,
      chunk(
        'IHDR',
        Buffer.concat([uint32(image.width), uint32(image.height), Buffer.from(BILEVEL_HEADER)]),
      ),
      chunk('IDAT', storedZlib(bilevelScanlines(image))),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
