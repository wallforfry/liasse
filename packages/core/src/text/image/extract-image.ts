import { isHeic } from '../../formats/heic.ts';
import { isJpeg, isPng } from '../../formats/signatures.ts';
import { TextExtractionError } from '../errors.ts';
import { toExtractedText } from '../result.ts';
import { transcribePageImage, type PageImage } from '../transcribe.ts';
import type { ExtractedText, ExtractionContext } from '../types.ts';
import { convertHeicToJpeg } from './heic.ts';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/heic';

// The predicates ingestion detects each type with: a file is refused here for its format
// exactly when ingestion would not have taken it for that type.
const HAS_FORMAT: Readonly<Record<ImageMime, (bytes: Uint8Array) => boolean>> = {
  'image/jpeg': isJpeg,
  'image/png': isPng,
  'image/heic': isHeic,
};

const toPageImage = async (
  bytes: Uint8Array,
  mime: ImageMime,
  { limits }: ExtractionContext,
): Promise<PageImage> => {
  if (!HAS_FORMAT[mime](bytes)) {
    throw new TextExtractionError('image_corrupt', `The file is not a valid ${mime} image`);
  }
  return mime === 'image/heic'
    ? { image: await convertHeicToJpeg(bytes, limits), mime: 'image/jpeg' }
    : { image: bytes, mime };
};

export const extractImage = async (
  bytes: Uint8Array,
  mime: ImageMime,
  context: ExtractionContext,
): Promise<ExtractedText> => {
  const page = await toPageImage(bytes, mime, context);
  const { text, model } = await transcribePageImage(page, context);
  return toExtractedText([{ text, visionModel: model }]);
};
