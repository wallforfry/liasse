import { TextExtractionError } from '../errors.ts';
import { transcribePageImage, visionResult, type PageImage } from '../transcribe.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { convertHeicToJpeg } from './heic.ts';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/heic';

const SIGNATURES = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
} as const;

const assertSignature = (bytes: Uint8Array, mime: keyof typeof SIGNATURES): void => {
  if (!SIGNATURES[mime].every((byte, index) => bytes[index] === byte)) {
    throw new TextExtractionError('image_corrupt', `The file is not a valid ${mime} image`);
  }
};

const toPageImage = async (
  bytes: Uint8Array,
  mime: ImageMime,
  { limits }: ExtractionContext,
): Promise<PageImage> => {
  if (mime === 'image/heic') {
    return { image: await convertHeicToJpeg(bytes, limits), mime: 'image/jpeg' };
  }
  assertSignature(bytes, mime);
  return { image: bytes, mime };
};

export const extractImage = async (
  bytes: Uint8Array,
  mime: ImageMime,
  context: ExtractionContext,
): Promise<ExtractedText> => {
  const page = await toPageImage(bytes, mime, context);
  const { maxImageBytes } = context.limits;
  if (page.image.length > maxImageBytes) {
    throw new TextExtractionError(
      'image_too_large',
      `The image weighs ${String(page.image.length)} bytes, more than the limit of ${String(maxImageBytes)}`,
    );
  }
  return visionResult([await transcribePageImage(page, context)]);
};
