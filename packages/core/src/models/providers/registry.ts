import type { EmbeddingModel, LanguageModel } from 'ai';
import type { EmbeddingProvider, LlmProvider } from '../../domain/enums.ts';
import type { EmbeddingKind } from '../ports.ts';

export interface ProviderEndpoint {
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
}

export type RemoteEmbeddingProvider = Exclude<EmbeddingProvider, 'local'>;
export type ModelProvider = LlmProvider | RemoteEmbeddingProvider;

interface EndpointTraits {
  // A self-hosted provider runs wherever its base URL points; the others are cloud services
  // whatever URL they are reached through.
  readonly selfHosted: boolean;
  readonly defaultBaseUrl?: string;
}

export type ProviderOptions = Readonly<Record<string, Readonly<Record<string, string | boolean>>>>;

interface LanguageAdapter {
  readonly languageModel: (endpoint: ProviderEndpoint, modelId: string) => Promise<LanguageModel>;
  readonly generationOptions?: ProviderOptions;
}

interface EmbeddingAdapter {
  readonly embeddingModel: (endpoint: ProviderEndpoint, modelId: string) => Promise<EmbeddingModel>;
  // Whether EMBEDDING_DIM is sent as the requested output size. Only for providers whose
  // current models accept it; the others reject or ignore the parameter.
  readonly requestsDimension: boolean;
  readonly taskOptions?: (kind: EmbeddingKind) => ProviderOptions;
}

type Adapter<P extends ModelProvider> = EndpointTraits &
  (P extends LlmProvider ? LanguageAdapter : unknown) &
  (P extends RemoteEmbeddingProvider ? EmbeddingAdapter : unknown);

// A provider enumerated in `domain/enums.ts` without an entry here does not compile.
type ProviderRegistry = { readonly [P in ModelProvider]: Adapter<P> };

const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

const GEMINI_TASK_TYPES = {
  query: 'RETRIEVAL_QUERY',
  passage: 'RETRIEVAL_DOCUMENT',
} as const satisfies Record<EmbeddingKind, string>;

// OpenAI's strict mode refuses a schema with an optional property, a free-key object or a
// format such as `uri`, all of which extraction schemas have. The schema is still sent, as a
// guide; the Zod schema decides what is accepted.
const LENIENT_OPENAI = { openai: { strictJsonSchema: false } } as const;
const LENIENT_OPENAI_COMPATIBLE = { openaiCompatible: { strictJsonSchema: false } } as const;

const settings = ({ apiKey, baseUrl }: ProviderEndpoint) => ({
  ...(apiKey === undefined ? {} : { apiKey }),
  ...(baseUrl === undefined ? {} : { baseURL: baseUrl }),
});

const anthropic = async (endpoint: ProviderEndpoint) =>
  (await import('@ai-sdk/anthropic')).createAnthropic(settings(endpoint));

const openai = async (endpoint: ProviderEndpoint) =>
  (await import('@ai-sdk/openai')).createOpenAI(settings(endpoint));

const mistral = async (endpoint: ProviderEndpoint) =>
  (await import('@ai-sdk/mistral')).createMistral(settings(endpoint));

const gemini = async (endpoint: ProviderEndpoint) =>
  (await import('@ai-sdk/google')).createGoogleGenerativeAI(settings(endpoint));

// `supportsStructuredOutputs` makes the SDK send the JSON Schema as
// `response_format: { type: 'json_schema' }`; without it the schema never reaches the server.
const openAiCompatible = async (name: string, baseURL: string, apiKey: string | undefined) =>
  (await import('@ai-sdk/openai-compatible')).createOpenAICompatible({
    name,
    baseURL,
    supportsStructuredOutputs: true,
    ...(apiKey === undefined ? {} : { apiKey }),
  });

// Ollama is reached through its OpenAI-compatible API, served under /v1 of the server root.
const ollama = ({ apiKey, baseUrl }: ProviderEndpoint) => {
  const root = (baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/v1$/, '');
  return openAiCompatible('ollama', `${root}/v1`, apiKey);
};

const openAiCompatibleEndpoint = ({ apiKey, baseUrl }: ProviderEndpoint) => {
  if (baseUrl === undefined) throw new Error('The openai-compatible provider needs a base URL');
  return openAiCompatible('openai-compatible', baseUrl, apiKey);
};

export const PROVIDERS: ProviderRegistry = {
  anthropic: {
    selfHosted: false,
    languageModel: async (endpoint, modelId) => (await anthropic(endpoint)).languageModel(modelId),
  },
  openai: {
    selfHosted: false,
    languageModel: async (endpoint, modelId) => (await openai(endpoint)).languageModel(modelId),
    generationOptions: LENIENT_OPENAI,
    embeddingModel: async (endpoint, modelId) => (await openai(endpoint)).embeddingModel(modelId),
    requestsDimension: true,
  },
  mistral: {
    selfHosted: false,
    languageModel: async (endpoint, modelId) => (await mistral(endpoint)).languageModel(modelId),
    embeddingModel: async (endpoint, modelId) => (await mistral(endpoint)).embeddingModel(modelId),
    requestsDimension: false,
  },
  gemini: {
    selfHosted: false,
    languageModel: async (endpoint, modelId) => (await gemini(endpoint)).languageModel(modelId),
    embeddingModel: async (endpoint, modelId) => (await gemini(endpoint)).embeddingModel(modelId),
    requestsDimension: true,
    taskOptions: (kind) => ({ google: { taskType: GEMINI_TASK_TYPES[kind] } }),
  },
  ollama: {
    selfHosted: true,
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    languageModel: async (endpoint, modelId) => (await ollama(endpoint)).languageModel(modelId),
    generationOptions: LENIENT_OPENAI_COMPATIBLE,
    embeddingModel: async (endpoint, modelId) => (await ollama(endpoint)).embeddingModel(modelId),
    requestsDimension: false,
  },
  'openai-compatible': {
    selfHosted: true,
    languageModel: async (endpoint, modelId) =>
      (await openAiCompatibleEndpoint(endpoint)).languageModel(modelId),
    generationOptions: LENIENT_OPENAI_COMPATIBLE,
    embeddingModel: async (endpoint, modelId) =>
      (await openAiCompatibleEndpoint(endpoint)).embeddingModel(modelId),
    requestsDimension: false,
  },
};
