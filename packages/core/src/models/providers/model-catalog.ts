import { z } from 'zod';
import { type ModelProvider, ollamaRoot } from './registry.ts';

/** What a section of the settings needs: a model that answers, or one that embeds. */
export type ModelPurpose = 'language' | 'embedding';

export interface CatalogPage {
  readonly ids: readonly string[];
  readonly next: URL | undefined;
}

/** Where a provider lists its models, and how its answer reads. */
export interface ModelCatalog {
  readonly firstPage: (baseUrl: string | undefined) => URL;
  readonly headers: (apiKey: string | undefined) => Readonly<Record<string, string>>;
  /** Undefined for an answer that is not a list of models. */
  readonly read: (body: unknown, purpose: ModelPurpose, page: URL) => CatalogPage | undefined;
}

// The default base URLs of the AI SDK adapters: a base URL in the settings replaces them
// and, as there, includes the version segment.
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const ANTHROPIC_VERSION = '2023-06-01';

const modelsUnder = (baseUrl: string, query: Readonly<Record<string, string>> = {}): URL => {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/models`);
  Object.entries(query).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });
  return url;
};

const withParam = (page: URL, name: string, value: string): URL => {
  const next = new URL(page);
  next.searchParams.set(name, value);
  return next;
};

const bearer = (apiKey: string | undefined): Readonly<Record<string, string>> =>
  apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };

const single = (ids: readonly string[]): CatalogPage => ({ ids, next: undefined });

const idListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

const openAiStyle = (defaultBaseUrl: string | undefined, provider: ModelProvider) =>
  ({
    firstPage: (baseUrl) => {
      const base = baseUrl ?? defaultBaseUrl;
      if (base === undefined) throw new Error(`The ${provider} provider needs a base URL`);
      return modelsUnder(base);
    },
    headers: bearer,
    read: (body) => {
      const parsed = idListSchema.safeParse(body);
      return parsed.success ? single(parsed.data.data.map(({ id }) => id)) : undefined;
    },
  }) satisfies ModelCatalog;

const anthropicPageSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});

const anthropic: ModelCatalog = {
  firstPage: (baseUrl) => modelsUnder(baseUrl ?? ANTHROPIC_BASE_URL, { limit: '1000' }),
  headers: (apiKey): Readonly<Record<string, string>> => ({
    'anthropic-version': ANTHROPIC_VERSION,
    ...(apiKey === undefined ? {} : { 'x-api-key': apiKey }),
  }),
  read: (body, _purpose, page) => {
    const parsed = anthropicPageSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const { data, has_more: hasMore, last_id: lastId } = parsed.data;
    return {
      ids: data.map(({ id }) => id),
      next: hasMore === true && lastId != null ? withParam(page, 'after_id', lastId) : undefined,
    };
  },
};

const mistralListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      capabilities: z.object({ completion_chat: z.boolean().optional() }).optional(),
    }),
  ),
});

// Mistral states which models chat; it states no embedding capability, so an embedder
// is chosen from the whole list.
const mistral: ModelCatalog = {
  firstPage: (baseUrl) => modelsUnder(baseUrl ?? MISTRAL_BASE_URL),
  headers: bearer,
  read: (body, purpose) => {
    const parsed = mistralListSchema.safeParse(body);
    if (!parsed.success) return undefined;
    return single(
      parsed.data.data
        .filter(
          ({ capabilities }) => purpose === 'embedding' || capabilities?.completion_chat !== false,
        )
        .map(({ id }) => id),
    );
  },
};

const geminiPageSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        supportedGenerationMethods: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

const GEMINI_METHODS = {
  language: 'generateContent',
  embedding: 'embedContent',
} as const satisfies Record<ModelPurpose, string>;

const gemini: ModelCatalog = {
  firstPage: (baseUrl) => modelsUnder(baseUrl ?? GEMINI_BASE_URL, { pageSize: '1000' }),
  headers: (apiKey): Readonly<Record<string, string>> =>
    apiKey === undefined ? {} : { 'x-goog-api-key': apiKey },
  read: (body, purpose, page) => {
    const parsed = geminiPageSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const method = GEMINI_METHODS[purpose];
    const { models, nextPageToken } = parsed.data;
    return {
      ids: models
        .filter(({ supportedGenerationMethods }) =>
          (supportedGenerationMethods ?? [method]).includes(method),
        )
        .map(({ name }) => name.replace(/^models\//, '')),
      next:
        nextPageToken === undefined || nextPageToken === ''
          ? undefined
          : withParam(page, 'pageToken', nextPageToken),
    };
  },
};

const ollamaTagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

// The OpenAI-compatible `/v1/models` of Ollama lists the same models; `/api/tags` is its own
// API and answers on every version that serves a model.
const ollama: ModelCatalog = {
  firstPage: (baseUrl) => new URL(`${ollamaRoot(baseUrl)}/api/tags`),
  headers: bearer,
  read: (body) => {
    const parsed = ollamaTagsSchema.safeParse(body);
    return parsed.success ? single(parsed.data.models.map(({ name }) => name)) : undefined;
  },
};

// A provider enumerated in `domain/enums.ts` without an entry here does not compile.
export const MODEL_CATALOGS: Readonly<Record<ModelProvider, ModelCatalog>> = {
  anthropic,
  openai: openAiStyle(OPENAI_BASE_URL, 'openai'),
  mistral,
  gemini,
  ollama,
  'openai-compatible': openAiStyle(undefined, 'openai-compatible'),
};
