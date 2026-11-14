import type { VisionModel } from '../ports.ts';
import { languageCall, type LlmConfig, runLanguageCall } from './language-call.ts';

// The transcription prompt of the request goes in the system message, the page image alone
// in the user message.
export const createVisionModel = (config: LlmConfig): VisionModel => {
  const call = languageCall(config, config.visionModel);
  return {
    transcribePage: async ({ image, mime, prompt, signal }) => {
      const { model, value } = await runLanguageCall(call, signal, async (sdk, options) => {
        const result = await sdk.generateText({
          ...options,
          instructions: prompt,
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
