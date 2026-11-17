import { z } from 'zod';
import type { EmbeddingProvider, LlmProvider } from './domain/enums.ts';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_EMBEDDING_TIMEOUT_MS,
  DEFAULT_HINDSIGHT_BANK,
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_NEW_TYPES_PER_DAY,
  DEFAULT_MAX_VISION_PAGES,
  ENTITY_ARBITRATION_SIMILARITY,
  ENTITY_ATTACH_SIMILARITY,
  MAX_API_KEY_LENGTH,
  MAX_EMBEDDING_INPUT_TOKENS,
  MAX_FILE_SIZE_LIMIT,
  MAX_MODEL_TIMEOUT_MS,
  MAX_NEW_TYPES_PER_DAY_LIMIT,
  MAX_VISION_PAGES_LIMIT,
  MIN_EMBEDDING_INPUT_TOKENS,
} from './domain/limits.ts';
import {
  autoApplyModeSchema,
  embeddingProviderSchema,
  httpBaseUrlSchema,
  llmProviderSchema,
  schemaLanguageSchema,
} from './domain/schemas.ts';

const text = z.string().trim().min(1);
const share = z.number().min(0).max(1);
const timeoutMs = z.int().min(1).max(MAX_MODEL_TIMEOUT_MS);
const apiKey = z.string().trim().min(1).max(MAX_API_KEY_LENGTH);

// The fields of each section but its key, which the stored document holds, a view says is
// set or not, and an update keeps, replaces or clears.
const llmFields = {
  provider: llmProviderSchema.default('anthropic'),
  base_url: httpBaseUrlSchema.optional(),
  text_model: text.describe('Classification, re-extraction and consolidation.'),
  vision_model: text.describe('Extraction from images and scanned pages.'),
  timeout_ms: timeoutMs.default(DEFAULT_LLM_TIMEOUT_MS),
};

const embeddingFields = {
  provider: embeddingProviderSchema.default('local'),
  model: text.optional().describe('Required for a remote provider; the local one has its own.'),
  base_url: httpBaseUrlSchema.optional(),
  timeout_ms: timeoutMs.default(DEFAULT_EMBEDDING_TIMEOUT_MS),
  max_input_tokens: z
    .int()
    .min(MIN_EMBEDDING_INPUT_TOKENS)
    .max(MAX_EMBEDDING_INPUT_TOKENS)
    .optional()
    .describe('Tokens a remote model reads per input; chunks are sized to fit.'),
};

const hindsightFields = {
  url: httpBaseUrlSchema.optional().describe('The integration is off without it.'),
  bank: text.default(DEFAULT_HINDSIGHT_BANK),
};

export const pipelineSettingsSchema = z.strictObject({
  max_file_size: z.int().min(1).max(MAX_FILE_SIZE_LIMIT).default(DEFAULT_MAX_FILE_SIZE),
  auto_apply: autoApplyModeSchema.default('safe'),
  confidence_threshold: share.default(DEFAULT_CONFIDENCE_THRESHOLD),
  max_new_types_per_day: z
    .int()
    .min(0)
    .max(MAX_NEW_TYPES_PER_DAY_LIMIT)
    .default(DEFAULT_MAX_NEW_TYPES_PER_DAY),
  schema_language: schemaLanguageSchema.default('en'),
  max_vision_pages: z.int().min(1).max(MAX_VISION_PAGES_LIMIT).default(DEFAULT_MAX_VISION_PAGES),
  entity_attach_similarity: share.default(ENTITY_ATTACH_SIMILARITY),
  entity_arbitration_similarity: share.default(ENTITY_ARBITRATION_SIMILARITY),
});
export type PipelineSettingsDocument = z.output<typeof pipelineSettingsSchema>;

type ModelProvider = LlmProvider | EmbeddingProvider;
const KEYLESS_PROVIDERS: readonly ModelProvider[] = ['local', 'ollama', 'openai-compatible'];
const BASE_URL_PROVIDERS: readonly ModelProvider[] = ['openai-compatible'];

interface Issue {
  readonly path: readonly string[];
  readonly message: string;
}

interface RuledSettings {
  readonly llm: { readonly provider: LlmProvider; readonly base_url?: string | undefined };
  readonly embedding: {
    readonly provider: EmbeddingProvider;
    readonly model?: string | undefined;
    readonly base_url?: string | undefined;
    readonly max_input_tokens?: number | undefined;
  };
  readonly pipeline: Pick<
    PipelineSettingsDocument,
    'entity_attach_similarity' | 'entity_arbitration_similarity'
  >;
}

const baseUrlIssues = (
  section: string,
  provider: ModelProvider,
  baseUrl: string | undefined,
): readonly Issue[] =>
  baseUrl === undefined && BASE_URL_PROVIDERS.includes(provider)
    ? [{ path: [section, 'base_url'], message: `required when provider is ${provider}` }]
    : [];

const embeddingIssues = ({ embedding }: RuledSettings): readonly Issue[] => {
  // The local model states its own window: a second figure could only contradict it.
  if (embedding.provider === 'local') {
    return embedding.max_input_tokens === undefined
      ? []
      : [
          {
            path: ['embedding', 'max_input_tokens'],
            message: 'only applies to a remote provider',
          },
        ];
  }
  return [
    ...(embedding.model === undefined
      ? [
          {
            path: ['embedding', 'model'],
            message: `required when provider is ${embedding.provider}`,
          },
        ]
      : []),
    ...baseUrlIssues('embedding', embedding.provider, embedding.base_url),
  ];
};

/** The rules between fields that hold whatever the keys are. */
const shapeIssues = (settings: RuledSettings): readonly Issue[] => [
  ...baseUrlIssues('llm', settings.llm.provider, settings.llm.base_url),
  ...embeddingIssues(settings),
  ...(settings.pipeline.entity_arbitration_similarity > settings.pipeline.entity_attach_similarity
    ? [
        {
          path: ['pipeline', 'entity_arbitration_similarity'],
          message: 'must not be above entity_attach_similarity',
        },
      ]
    : []),
];

const missingKey = (
  section: string,
  provider: ModelProvider,
  key: string | undefined,
): readonly Issue[] =>
  key === undefined && !KEYLESS_PROVIDERS.includes(provider)
    ? [{ path: [section, 'api_key'], message: `required when provider is ${provider}` }]
    : [];

const report = (ctx: z.RefinementCtx, issues: readonly Issue[]): void => {
  issues.forEach(({ path, message }) => {
    ctx.addIssue({ code: 'custom', path: [...path], message });
  });
};

/**
 * The whole settings document, keys in clear: what the server holds once it has decrypted
 * them, and what the evaluation harness reads from its file. Never an answer of the API.
 */
export const settingsSchema = z
  .strictObject({
    llm: z.strictObject({ ...llmFields, api_key: apiKey.optional() }),
    embedding: z.strictObject({ ...embeddingFields, api_key: apiKey.optional() }).prefault({}),
    pipeline: pipelineSettingsSchema.prefault({}),
    hindsight: z.strictObject({ ...hindsightFields, api_key: apiKey.optional() }).prefault({}),
  })
  .superRefine((settings, ctx) => {
    report(ctx, [
      ...shapeIssues(settings),
      ...missingKey('llm', settings.llm.provider, settings.llm.api_key),
      ...missingKey('embedding', settings.embedding.provider, settings.embedding.api_key),
    ]);
  });
export type Settings = z.output<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

/** A key the caller is never shown: kept as stored, replaced by `value`, or removed. */
export const secretUpdateSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('keep') }),
  z.strictObject({ action: z.literal('replace'), value: apiKey }),
  z.strictObject({ action: z.literal('clear') }),
]);
export type SecretUpdate = z.output<typeof secretUpdateSchema>;

const KEEP: SecretUpdate = { action: 'keep' };
const keyUpdate = secretUpdateSchema.default(KEEP);

/**
 * The settings a person sends. The rule of a required key waits for the stored keys: the
 * server checks it on the document the update leads to.
 */
export const settingsDraftSchema = z
  .strictObject({
    llm: z.strictObject({ ...llmFields, api_key: keyUpdate }),
    embedding: z.strictObject({ ...embeddingFields, api_key: keyUpdate }).prefault({}),
    pipeline: pipelineSettingsSchema.prefault({}),
    hindsight: z.strictObject({ ...hindsightFields, api_key: keyUpdate }).prefault({}),
  })
  .superRefine((settings, ctx) => {
    report(ctx, shapeIssues(settings));
  });
export type SettingsDraft = z.output<typeof settingsDraftSchema>;
export type SettingsDraftInput = z.input<typeof settingsDraftSchema>;

const keySet = z.boolean().describe('Whether a key is stored. The key itself is never answered.');

/** The settings as the API answers them: every key replaced by whether it is set. */
export const settingsViewSchema = z.object({
  llm: z.object({ ...llmFields, api_key_set: keySet }),
  embedding: z.object({ ...embeddingFields, api_key_set: keySet }),
  pipeline: pipelineSettingsSchema,
  hindsight: z.object({ ...hindsightFields, api_key_set: keySet }),
});
export type SettingsView = z.output<typeof settingsViewSchema>;
