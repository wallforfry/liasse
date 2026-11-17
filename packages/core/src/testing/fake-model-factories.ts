import type { HindsightClient } from '../hindsight/client.ts';
import type { Embedder, TextModel, VisionModel } from '../models/ports.ts';
import type { ModelFactories } from '../settings/factories.ts';
import type { EmbeddingSettings, LlmSettings } from '../settings/resolve.ts';
import { createFakeEmbedder } from './fake-embedder.ts';
import { createFakeTextModel } from './fake-text-model.ts';
import { createFakeVisionModel } from './fake-vision-model.ts';

export interface FakeModelFactoryOverrides {
  readonly textModel?: (llm: LlmSettings) => TextModel;
  readonly visionModel?: (llm: LlmSettings) => VisionModel;
  readonly embedder?: (embedding: EmbeddingSettings) => Embedder;
  readonly hindsightProbe?: () => HindsightClient;
}

const HINDSIGHT_PROBE: HindsightClient = {
  retain: () => Promise.resolve(),
  forget: () => Promise.resolve(false),
  requestWindowMs: 0,
};

/**
 * Factories that build fakes, never a client of a provider: a text model that answers
 * `{ ok: true }`, a vision model, an embedder of the dimension of the settings and a bank
 * that holds nothing.
 */
export const createFakeModelFactories = ({
  textModel = () => createFakeTextModel(() => ({ ok: true })),
  visionModel = () => createFakeVisionModel(() => ''),
  embedder = ({ dimension }) => createFakeEmbedder({ dimension }),
  hindsightProbe = () => HINDSIGHT_PROBE,
}: FakeModelFactoryOverrides = {}): ModelFactories => ({
  textModel,
  visionModel,
  embedder: (embedding) =>
    Promise.resolve({ embedder: embedder(embedding), close: () => Promise.resolve() }),
  hindsightProbe,
});
