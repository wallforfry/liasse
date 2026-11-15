import {
  type EmbeddingProvider,
  embeddingProviderSchema,
  type LlmProvider,
  llmProviderSchema,
  MAX_EMBEDDING_DIM,
  MIN_EMBEDDING_INPUT_TOKENS,
} from '@liasse/contract/domain';
import { z } from 'zod';
import {
  baseUrl,
  type CrossFieldProblem,
  duration,
  integer,
  reportProblems,
  text,
} from './fields.ts';

type ModelProvider = LlmProvider | EmbeddingProvider;

const KEYLESS_PROVIDERS: readonly ModelProvider[] = ['local', 'ollama', 'openai-compatible'];
const BASE_URL_PROVIDERS: readonly ModelProvider[] = ['openai-compatible'];

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
    LLM_BASE_URL: baseUrl.optional(),
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
    EMBEDDING_MAX_INPUT_TOKENS: integer(MIN_EMBEDDING_INPUT_TOKENS, 1_000_000).optional(),
    EMBEDDING_API_KEY: text.optional(),
    EMBEDDING_BASE_URL: baseUrl.optional(),
    EMBEDDING_TIMEOUT: duration.prefault('1m'),
  })
  .transform((env, ctx) => {
    if (env.EMBEDDING_PROVIDER === 'local') {
      // The local model states its own window: a second figure could only contradict it.
      if (env.EMBEDDING_MAX_INPUT_TOKENS !== undefined) {
        reportProblems(ctx, [
          {
            key: 'EMBEDDING_MAX_INPUT_TOKENS',
            message: 'only applies when EMBEDDING_PROVIDER is not local',
          },
        ]);
        return z.NEVER;
      }
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
      maxInputTokens: env.EMBEDDING_MAX_INPUT_TOKENS,
    });
  });
