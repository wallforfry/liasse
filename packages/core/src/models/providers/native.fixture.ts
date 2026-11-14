import { SYNTHETIC_API_KEY } from '../../testing/provider-wire.ts';

// Minimal successful responses in the native wire format of each cloud provider, enough for
// the provider package to accept them. The local server stands in for the provider's API.

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

const anthropicMessage = (content: unknown): unknown => ({
  id: 'msg_synthetic',
  type: 'message',
  role: 'assistant',
  model: 'claude-resolved-2026',
  content: [content],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage,
});

// What Anthropic answers to `output_config.format`: the JSON as a text block.
export const anthropicJsonText = (output: unknown): unknown =>
  anthropicMessage({ type: 'text', text: JSON.stringify(output) });

export const NATIVE_GENERATION = {
  anthropic: {
    path: '/v1/messages',
    credential: { 'x-api-key': SYNTHETIC_API_KEY },
    resolvedModel: 'claude-resolved-2026',
    // The answer to the forced `json` tool, which the provider package uses for a model
    // or a schema that native structured outputs cannot take.
    respond: (output: unknown): unknown =>
      anthropicMessage({ type: 'tool_use', id: 'toolu_synthetic', name: 'json', input: output }),
  },
  openai: {
    path: '/v1/responses',
    credential: { authorization: `Bearer ${SYNTHETIC_API_KEY}` },
    resolvedModel: 'gpt-resolved-2026',
    respond: (output: unknown): unknown => ({
      id: 'resp_synthetic',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-resolved-2026',
      output: [
        {
          type: 'message',
          id: 'msg_synthetic',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
        },
      ],
      usage,
    }),
  },
  mistral: {
    path: '/v1/chat/completions',
    credential: { authorization: `Bearer ${SYNTHETIC_API_KEY}` },
    resolvedModel: 'mistral-resolved-2026',
    respond: (output: unknown): unknown => ({
      id: 'cmpl-synthetic',
      object: 'chat.completion',
      created: 1,
      model: 'mistral-resolved-2026',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(output) },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
  },
  gemini: {
    path: '/v1/models/text-model:generateContent',
    credential: { 'x-goog-api-key': SYNTHETIC_API_KEY },
    // The Google provider package does not report `modelVersion` as the model id.
    resolvedModel: 'text-model',
    respond: (output: unknown): unknown => ({
      candidates: [
        {
          index: 0,
          content: { role: 'model', parts: [{ text: JSON.stringify(output) }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      modelVersion: 'gemini-resolved-2026',
    }),
  },
} as const;
