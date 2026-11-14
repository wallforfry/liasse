import { normalizeText } from './normalize.ts';
import { TRANSCRIPTION_PROMPT } from './transcription-prompt.ts';
import type { ExtractedText, ExtractionContext } from './types.ts';

export interface PageImage {
  readonly image: Uint8Array;
  readonly mime: string;
}

export interface Transcription {
  readonly text: string;
  readonly model: string;
}

export const transcribePageImage = async (
  { image, mime }: PageImage,
  { vision, signal }: ExtractionContext,
): Promise<Transcription> => {
  const { markdown, model } = await vision.transcribePage({
    image,
    mime,
    prompt: TRANSCRIPTION_PROMPT,
    ...(signal === undefined ? {} : { signal }),
  });
  return { text: normalizeText(markdown), model };
};

export const visionResult = (transcriptions: readonly Transcription[]): ExtractedText => {
  const visionModel = transcriptions[0]?.model;
  return {
    pages: transcriptions.map(({ text }, index) => ({ page: index + 1, text })),
    method: 'vision',
    ...(visionModel === undefined ? {} : { visionModel }),
    attachments: [],
  };
};
