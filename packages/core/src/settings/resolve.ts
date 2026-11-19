import type { Settings } from '@liasse/contract';
import type {
  AutoApplyMode,
  EmbeddingProvider,
  LlmProvider,
  SchemaLanguage,
} from '@liasse/contract/domain';

export interface LlmSettings {
  readonly provider: LlmProvider;
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
  readonly visionModel: string;
  readonly textModel: string;
  readonly timeoutMs: number;
}

export interface LocalEmbeddingSettings {
  readonly provider: 'local';
  readonly model: string | undefined;
  readonly dimension: number;
  readonly cacheDir: string;
}

export interface RemoteEmbeddingSettings {
  readonly provider: Exclude<EmbeddingProvider, 'local'>;
  readonly model: string;
  readonly dimension: number;
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
  readonly maxInputTokens: number | undefined;
}

export type EmbeddingSettings = LocalEmbeddingSettings | RemoteEmbeddingSettings;

export interface PipelineConfig {
  readonly maxFileSize: number;
  readonly autoApply: AutoApplyMode;
  readonly confidenceThreshold: number;
  readonly schemaLanguage: SchemaLanguage;
  readonly maxVisionPages: number;
  readonly entitySimilarity: { readonly attach: number; readonly arbitrate: number };
}

export interface HindsightSettings {
  readonly url: string;
  readonly bank: string;
  readonly apiKey: string | undefined;
}

/** The settings as the process uses them, with what the environment adds to the embedder. */
export interface ResolvedSettings {
  readonly llm: LlmSettings;
  readonly embedding: EmbeddingSettings;
  readonly pipeline: PipelineConfig;
  /** Undefined when the integration is off. */
  readonly hindsight: HindsightSettings | undefined;
}

/** `EMBEDDING_DIM` and `EMBEDDING_CACHE_DIR`: typed by the first migration, never settings. */
export interface EmbeddingEnvironment {
  readonly dimension: number;
  readonly cacheDir: string;
}

const embeddingOf = (
  { embedding }: Settings,
  { dimension, cacheDir }: EmbeddingEnvironment,
): EmbeddingSettings => {
  if (embedding.provider === 'local') {
    return Object.freeze({ provider: 'local', model: embedding.model, dimension, cacheDir });
  }
  // The schema asks a remote provider for its model; this narrows what it proved.
  if (embedding.model === undefined) throw new Error('A remote embedder needs its model');
  return Object.freeze({
    provider: embedding.provider,
    model: embedding.model,
    dimension,
    apiKey: embedding.api_key,
    baseUrl: embedding.base_url,
    timeoutMs: embedding.timeout_ms,
    maxInputTokens: embedding.max_input_tokens,
  });
};

/** Turns a parsed settings document into the parts the process builds its models from. */
export const resolveSettings = (
  settings: Settings,
  environment: EmbeddingEnvironment,
): ResolvedSettings => {
  const { llm, pipeline, hindsight } = settings;
  return Object.freeze({
    llm: Object.freeze({
      provider: llm.provider,
      apiKey: llm.api_key,
      baseUrl: llm.base_url,
      visionModel: llm.vision_model,
      textModel: llm.text_model,
      timeoutMs: llm.timeout_ms,
    }),
    embedding: embeddingOf(settings, environment),
    pipeline: Object.freeze({
      maxFileSize: pipeline.max_file_size,
      autoApply: pipeline.auto_apply,
      confidenceThreshold: pipeline.confidence_threshold,
      schemaLanguage: pipeline.schema_language,
      maxVisionPages: pipeline.max_vision_pages,
      entitySimilarity: Object.freeze({
        attach: pipeline.entity_attach_similarity,
        arbitrate: pipeline.entity_arbitration_similarity,
      }),
    }),
    hindsight:
      hindsight.url === undefined
        ? undefined
        : Object.freeze({ url: hindsight.url, bank: hindsight.bank, apiKey: hindsight.api_key }),
  });
};
