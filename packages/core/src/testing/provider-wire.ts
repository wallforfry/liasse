import { settingsSchema } from '@liasse/contract';
import { z } from 'zod';
import {
  type LlmSettings,
  type RemoteEmbeddingSettings,
  resolveSettings,
} from '../settings/resolve.ts';
import { SYNTHETIC_EMBEDDING_ENVIRONMENT, SYNTHETIC_SETTINGS } from './synthetic-settings.ts';
import type { StubRequest, StubResponse } from './provider-stub-server.ts';

// Responses in the wire format of the OpenAI Chat Completions and Embeddings APIs, which
// Ollama and every `openai-compatible` server speak.

export const SYNTHETIC_API_KEY = 'synthetic-key-5f2c9a';
export const RESOLVED_MODEL = 'resolved-model-2026-01';

export interface ChatCompletionOptions {
  readonly finishReason?: string;
  readonly model?: string;
}

export const chatCompletion = (
  content: string | null,
  { finishReason = 'stop', model = RESOLVED_MODEL }: ChatCompletionOptions = {},
): StubResponse => ({
  body: {
    id: 'chatcmpl-synthetic',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
});

// `retry-after-ms` replaces the two-second backoff of the SDK, so retries are immediate.
export const failure = (
  status: number,
  message: string,
  type = 'synthetic_error',
  code?: string,
): StubResponse => ({
  status,
  headers: { 'retry-after-ms': '0' },
  body: { error: { message, type, ...(code === undefined ? {} : { code }) } },
});

const embeddingInput = z.object({ input: z.array(z.string()) });

export const embeddingInputOf = (request: StubRequest): readonly string[] =>
  embeddingInput.parse(request.body).input;

export interface IndexedEmbedding {
  readonly index: number;
  readonly embedding: readonly number[];
}

// `index` is the position of the text in the request; a server may answer in any order.
export const indexedEmbeddings = (data: readonly IndexedEmbedding[]): StubResponse => ({
  body: {
    object: 'list',
    model: RESOLVED_MODEL,
    data: data.map((item) => ({ object: 'embedding', ...item })),
    usage: { prompt_tokens: 1, total_tokens: 1 },
  },
});

export const embeddings = (vectors: readonly (readonly number[])[]): StubResponse =>
  indexedEmbeddings(vectors.map((embedding, index) => ({ index, embedding })));

// Loose on purpose: the tables of the provider tests name sections with plain strings, and
// the schema of the contract checks them all the same.
type Section = Readonly<Record<string, unknown>>;

/** The language model settings of the synthetic ones with these fields changed. */
export const llmSettings = (llm: Section): LlmSettings =>
  resolveSettings(
    settingsSchema.parse({ llm: { ...SYNTHETIC_SETTINGS.llm, ...llm } }),
    SYNTHETIC_EMBEDDING_ENVIRONMENT,
  ).llm;

/** Remote embedder settings, `embedding-model` unless named, of `dimension` dimensions. */
export const remoteEmbeddingSettings = (
  embedding: Section,
  dimension: number = SYNTHETIC_EMBEDDING_ENVIRONMENT.dimension,
): RemoteEmbeddingSettings => {
  const resolved = resolveSettings(
    settingsSchema.parse({
      llm: SYNTHETIC_SETTINGS.llm,
      embedding: { model: 'embedding-model', ...embedding },
    }),
    { ...SYNTHETIC_EMBEDDING_ENVIRONMENT, dimension },
  ).embedding;
  if (resolved.provider === 'local') throw new Error('expected a remote embedding provider');
  return resolved;
};
