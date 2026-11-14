import { TextExtractionError } from './errors.ts';
import { normalizeText } from './normalize.ts';
import { TRANSCRIPTION_PROMPT } from './transcription-prompt.ts';
import type { ExtractionContext } from './types.ts';

export interface PageImage {
  readonly image: Uint8Array;
  readonly mime: string;
}

export interface Transcription {
  readonly text: string;
  readonly model: string;
}

// The one place an image leaves for the vision model, whether it is a file or a rendered
// PDF page, so the weight limit holds for both.
export const transcribePageImage = async (
  { image, mime }: PageImage,
  { vision, signal, limits }: ExtractionContext,
): Promise<Transcription> => {
  if (image.length > limits.maxImageBytes) {
    throw new TextExtractionError(
      'image_too_large',
      `The image for the vision model weighs ${String(image.length)} bytes, more than the limit of ${String(limits.maxImageBytes)}`,
    );
  }
  const { markdown, model } = await vision.transcribePage({
    image,
    mime,
    prompt: TRANSCRIPTION_PROMPT,
    ...(signal === undefined ? {} : { signal }),
  });
  return { text: normalizeText(markdown), model };
};
