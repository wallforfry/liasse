import { crc32, deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GREYSCALE_8_BITS = [8, 0, 0, 0, 0];

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  return Buffer.concat([uint32(data.length), typed, uint32(crc32(typed))]);
};

// A greyscale gradient: enough for a real decoder to accept, with nothing to read on it.
export const buildSyntheticPng = (width: number, height: number): Uint8Array => {
  const scanlines = Uint8Array.from({ length: height * (width + 1) }, (_, index) => {
    const column = index % (width + 1);
    return column === 0 ? 0 : Math.round(((column - 1) * 255) / Math.max(1, width - 1));
  });
  return Uint8Array.from(
    Buffer.concat([
      PNG_SIGNATURE,
      chunk('IHDR', Buffer.concat([uint32(width), uint32(height), Buffer.from(GREYSCALE_8_BITS)])),
      chunk('IDAT', deflateSync(scanlines)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
};
