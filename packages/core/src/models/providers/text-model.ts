import { ModelOutputError } from '../errors.ts';
import type { TextModel } from '../ports.ts';
import { languageCall, type LlmConfig, runLanguageCall } from './language-call.ts';
import { describeIssues } from './safe-text.ts';
import { wireSchema } from './wire-schema.ts';

export const createTextModel = (config: LlmConfig): TextModel => {
  const call = languageCall(config, config.textModel);
  return {
    generateObject: async ({ schema, system, prompt, signal }) => {
      const { model, value } = await runLanguageCall(call, signal, async (sdk, options) => {
        const result = await sdk.generateText({
          ...options,
          instructions: system,
          prompt,
          output: sdk.Output.object({ schema: await wireSchema(sdk, schema) }),
        });
        return {
          finishReason: result.finishReason,
          reportedModel: result.finalStep.response.modelId,
          value: result.output,
        };
      });
      const parsed = await schema.safeParseAsync(value);
      if (!parsed.success) throw new ModelOutputError(model, describeIssues(parsed.error, schema));
      return { object: parsed.data, model };
    },
  };
};
