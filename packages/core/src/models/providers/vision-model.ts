import type { VisionModel } from '../ports.ts';
import type { LlmSettings } from '../../settings/resolve.ts';
import { languageCall, runLanguageCall } from './language-call.ts';

// The transcription prompt of the request goes in the system message, the page image alone
// in the user message.
export const createVisionModel = (config: LlmSettings): VisionModel => {
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
          reportedModel: result.finalStep.response.modelId,
          value: result.text,
        };
      });
      return { markdown: value.trim(), model };
    },
  };
};
