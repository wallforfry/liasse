import type { VisionModel } from '../ports.ts';
import { languageCall, type LlmConfig, runLanguageCall } from './language-call.ts';

// `instructions` is the transcription prompt, owned by the text extraction code: the
// adapter only carries it, as the system message, next to the page image.
export const createVisionModel = (config: LlmConfig, instructions: string): VisionModel => {
  const call = languageCall(config, config.visionModel);
  return {
    transcribePage: async ({ image, mime, signal }) => {
      const { model, value } = await runLanguageCall(call, signal, async (sdk, options) => {
        const result = await sdk.generateText({
          ...options,
          instructions,
          messages: [{ role: 'user', content: [{ type: 'file', data: image, mediaType: mime }] }],
        });
        return {
          finishReason: result.finishReason,
          model: result.finalStep.response.modelId,
          value: result.text,
        };
      });
      return { markdown: value.trim(), model };
    },
  };
};
