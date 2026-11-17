import {
  type ConfiguredEmbedder,
  createEmbedder,
  type CreateEmbedderOptions,
} from '../embeddings/create.ts';
import { createHindsightClient, type HindsightClient } from '../hindsight/client.ts';
import type { TextModel, VisionModel } from '../models/ports.ts';
import { createTextModel } from '../models/providers/text-model.ts';
import { createVisionModel } from '../models/providers/vision-model.ts';
import type { EmbeddingSettings, HindsightSettings, LlmSettings } from './resolve.ts';

/** How the parts that call a provider are built from the settings; tests give fakes. */
export interface ModelFactories {
  readonly textModel: (llm: LlmSettings) => TextModel;
  readonly visionModel: (llm: LlmSettings) => VisionModel;
  readonly embedder: (embedding: EmbeddingSettings) => Promise<ConfiguredEmbedder>;
  /** A client of the bank for a check, which asks once. */
  readonly hindsightProbe: (hindsight: HindsightSettings) => HindsightClient;
}

// A check asks once and gives up early: a retry or a slow window would only delay its answer.
const PROBE_POLICY = { timeoutMs: 15_000, retries: 0 } as const;

export const providerFactories = (embedder: CreateEmbedderOptions = {}): ModelFactories => ({
  textModel: createTextModel,
  visionModel: createVisionModel,
  embedder: (embedding) => createEmbedder(embedding, embedder),
  hindsightProbe: (hindsight) => createHindsightClient(hindsight, PROBE_POLICY),
});
