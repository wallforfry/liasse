import type { TranscribePageRequest, VisionModel } from '../models/ports.ts';

export type FakeVisionHandler = (request: TranscribePageRequest) => string | Promise<string>;

export interface FakeVisionModel extends VisionModel {
  readonly calls: readonly TranscribePageRequest[];
}

// Synthetic fixtures can use UTF-8 text as their "image": the default transcription is that text.
const decodeImageAsText: FakeVisionHandler = ({ image }) => new TextDecoder().decode(image);

export const createFakeVisionModel = (
  transcribe: FakeVisionHandler = decodeImageAsText,
  model = 'fake-vision-model',
): FakeVisionModel => {
  const calls: TranscribePageRequest[] = [];
  return {
    calls,
    transcribePage: async (request) => {
      request.signal?.throwIfAborted();
      calls.push(request);
      return { markdown: await transcribe(request), model };
    },
  };
};
