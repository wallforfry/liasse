import { z } from 'zod';
import type { EmbeddingProvider, LlmProvider } from '../domain/enums.ts';
import { MAX_EMBEDDING_DIM } from '../domain/limits.ts';
import { embeddingProviderSchema, llmProviderSchema } from '../domain/schemas.ts';
import { type CrossFieldProblem, duration, integer, reportProblems, text } from './fields.ts';

type ModelProvider = LlmProvider | EmbeddingProvider;

const KEYLESS_PROVIDERS: readonly ModelProvider[] = ['local', 'ollama', 'openai-compatible'];
const BASE_URL_PROVIDERS: readonly ModelProvider[] = ['openai-compatible'];

// A provider package sends the key in a header and appends its paths to the base URL, so
// credentials or a query string in the URL cannot work; they would only end up in logs.
const modelBaseUrl = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const { protocol, username, password, search } = new URL(value);
  return (
    (protocol === 'http:' || protocol === 'https:') &&
    username === '' &&
    password === '' &&
    search === ''
  );
}, 'expected an http or https URL without credentials or query string');

interface ProviderAccess {
  readonly prefix: 'LLM' | 'EMBEDDING';
  readonly provider: ModelProvider;
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
}

const providerAccessProblems = ({
  prefix,
  provider,
  apiKey,
  baseUrl,
}: ProviderAccess): readonly CrossFieldProblem[] => [
  ...(apiKey === undefined && !KEYLESS_PROVIDERS.includes(provider)
    ? [{ key: `${prefix}_API_KEY`, message: `required when ${prefix}_PROVIDER=${provider}` }]
    : []),
  ...(baseUrl === undefined && BASE_URL_PROVIDERS.includes(provider)
    ? [{ key: `${prefix}_BASE_URL`, message: `required when ${prefix}_PROVIDER=${provider}` }]
    : []),
];

export const llmSection = z
  .object({
    LLM_PROVIDER: llmProviderSchema.default('anthropic'),
    LLM_API_KEY: text.optional(),
    LLM_BASE_URL: modelBaseUrl.optional(),
    VISION_MODEL: text,
    TEXT_MODEL: text,
    LLM_TIMEOUT: duration.prefault('5m'),
  })
  .transform((env, ctx) => {
    const problems = providerAccessProblems({
      prefix: 'LLM',
      provider: env.LLM_PROVIDER,
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
    });
    if (problems.length > 0) {
      reportProblems(ctx, problems);
      return z.NEVER;
    }
    return Object.freeze({
      provider: env.LLM_PROVIDER,
      apiKey: env.LLM_API_KEY,
      baseUrl: env.LLM_BASE_URL,
      visionModel: env.VISION_MODEL,
      textModel: env.TEXT_MODEL,
      timeoutMs: env.LLM_TIMEOUT,
    });
  });

export const embeddingSection = z
  .object({
    EMBEDDING_PROVIDER: embeddingProviderSchema.default('local'),
    EMBEDDING_MODEL: text.optional(),
    EMBEDDING_DIM: integer(1, MAX_EMBEDDING_DIM).default(384),
    EMBEDDING_CACHE_DIR: text.default('/data/models'),
    EMBEDDING_API_KEY: text.optional(),
    EMBEDDING_BASE_URL: modelBaseUrl.optional(),
    EMBEDDING_TIMEOUT: duration.prefault('1m'),
  })
  .transform((env, ctx) => {
    if (env.EMBEDDING_PROVIDER === 'local') {
      return Object.freeze({
        provider: env.EMBEDDING_PROVIDER,
        model: env.EMBEDDING_MODEL,
        dimension: env.EMBEDDING_DIM,
        cacheDir: env.EMBEDDING_CACHE_DIR,
      });
    }
    const accessProblems = providerAccessProblems({
      prefix: 'EMBEDDING',
      provider: env.EMBEDDING_PROVIDER,
      apiKey: env.EMBEDDING_API_KEY,
      baseUrl: env.EMBEDDING_BASE_URL,
    });
    if (env.EMBEDDING_MODEL === undefined || accessProblems.length > 0) {
      reportProblems(ctx, [
        ...(env.EMBEDDING_MODEL === undefined
          ? [
              {
                key: 'EMBEDDING_MODEL',
                message: `required when EMBEDDING_PROVIDER=${env.EMBEDDING_PROVIDER}`,
              },
            ]
          : []),
        ...accessProblems,
      ]);
      return z.NEVER;
    }
    return Object.freeze({
      provider: env.EMBEDDING_PROVIDER,
      model: env.EMBEDDING_MODEL,
      dimension: env.EMBEDDING_DIM,
      apiKey: env.EMBEDDING_API_KEY,
      baseUrl: env.EMBEDDING_BASE_URL,
      timeoutMs: env.EMBEDDING_TIMEOUT,
    });
  });
