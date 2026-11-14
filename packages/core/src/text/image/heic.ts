import { TextExtractionError } from '../errors.ts';
import type { TextLimits } from '../limits.ts';
import { downscaleRgba, fitWithin, type RgbaImage } from './scale.ts';

const JPEG_QUALITY = 90;

// Both decoders are pure JavaScript and WebAssembly (libheif alone is several megabytes),
// so they are loaded only when a HEIC file actually arrives.
const loadHeicDecoder = () => import('heic-decode');
const loadJpegEncoder = () => import('jpeg-js');

const decodeFirstImage = async (
  bytes: Uint8Array,
  { maxHeicPixels }: TextLimits,
): Promise<RgbaImage> => {
  const { all } = await loadHeicDecoder();
  const images = await all({ buffer: bytes });
  try {
    const [first] = images;
    if (first === undefined) throw new Error('The HEIC file holds no image');
    if (first.width * first.height > maxHeicPixels) {
      throw new TextExtractionError(
        'image_too_large',
        `The HEIC image has ${String(first.width)}x${String(first.height)} pixels, more than the limit of ${String(maxHeicPixels)}`,
      );
    }
    return await first.decode();
  } finally {
    images.dispose();
  }
};

export const convertHeicToJpeg = async (
  bytes: Uint8Array,
  limits: TextLimits,
): Promise<Uint8Array> => {
  try {
    const decoded = await decodeFirstImage(bytes, limits);
    const scaled = downscaleRgba(decoded, fitWithin(decoded, limits.maxHeicEdgePx));
    const { encode } = await loadJpegEncoder();
    return Uint8Array.from(encode(scaled, JPEG_QUALITY).data);
  } catch (error) {
    if (error instanceof TextExtractionError) throw error;
    throw new TextExtractionError('image_corrupt', 'The HEIC image could not be decoded', {
      cause: error,
    });
  }
};
