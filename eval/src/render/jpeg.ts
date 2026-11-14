import { encode } from 'jpeg-js';
import type { GrayImage } from './raster.ts';

const RGBA_CHANNELS = 4;
const OPAQUE = 255;

// jpeg-js is a pure JavaScript encoder: its output depends on the pixels and the quality
// alone, which is what lets the committed files be compared byte for byte. It only writes
// three-component files, so the grey level is repeated on each channel.
export const encodeJpeg = ({ width, height, data }: GrayImage, quality: number): Uint8Array => {
  const rgba = Uint8Array.from({ length: width * height * RGBA_CHANNELS }, (_, index) =>
    index % RGBA_CHANNELS === RGBA_CHANNELS - 1 ? OPAQUE : (data[index >> 2] ?? 0),
  );
  return Uint8Array.from(encode({ width, height, data: rgba }, quality).data);
};
